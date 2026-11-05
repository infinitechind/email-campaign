import { requireUser } from "@/lib/auth";
import { getSmtp } from "@/lib/db";
import { fromHeader, makeTransport } from "@/lib/queue";

/** Verify the saved SMTP connection; optionally send a test email to `to`. */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const cfg = await getSmtp(user._id);
  if (!cfg) return Response.json({ error: "Save SMTP settings first" }, { status: 400 });
  const { to } = (await req.json().catch(() => ({}))) as { to?: string };
  const t = makeTransport(cfg);
  try {
    await t.verify();
    if (to) {
      await t.sendMail({
        from: fromHeader(cfg),
        to,
        subject: "Bulk Email – SMTP test",
        text: "Your SMTP settings work.",
      });
    }
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  } finally {
    t.close();
  }
}
