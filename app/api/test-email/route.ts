import { requireUser } from "@/lib/auth";
import { getSmtp } from "@/lib/db";
import { fromHeader, makeTransport } from "@/lib/queue";
import { render } from "@/lib/render";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 5;

/**
 * Send a single rendered template immediately (bypasses the queue).
 * Body: { to, subject, body, data?, replyTo?, prefix? }
 * `subject`/`body` are the raw template (possibly unsaved), `data` fills {{placeholders}}.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const cfg = await getSmtp(user._id);
  if (!cfg) return Response.json({ error: "Configure SMTP settings first" }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as {
    to?: string;
    subject?: string;
    body?: string;
    data?: Record<string, string>;
    replyTo?: string;
    prefix?: boolean;
  };

  const to = String(b.to ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (to.length === 0 || !to.every((a) => EMAIL_RE.test(a))) {
    return Response.json({ error: "Enter a valid recipient email address" }, { status: 400 });
  }
  if (to.length > MAX_RECIPIENTS) {
    return Response.json({ error: `Test emails are limited to ${MAX_RECIPIENTS} recipients` }, { status: 400 });
  }
  if (!b.subject || !b.body) return Response.json({ error: "Template subject and body are required" }, { status: 400 });

  const replyTo = String(b.replyTo ?? "").trim();
  if (replyTo && !replyTo.split(",").every((a) => EMAIL_RE.test(a.trim()))) {
    return Response.json({ error: "Reply-To must be a valid email address" }, { status: 400 });
  }

  const data = Object.fromEntries(Object.entries(b.data ?? {}).map(([k, v]) => [k, String(v ?? "")]));
  const subject = render(b.subject, data);
  const t = makeTransport(cfg);
  try {
    const info = await t.sendMail({
      from: fromHeader(cfg),
      to,
      subject: b.prefix === false ? subject : `[TEST] ${subject}`,
      html: render(b.body, data, true),
      replyTo: replyTo || undefined,
    });
    return Response.json({ ok: true, messageId: info.messageId, accepted: info.accepted });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  } finally {
    t.close();
  }
}
