import { requireUser } from "@/lib/auth";
import { cols, getSmtp, smtpOut } from "@/lib/db";
import { kick } from "@/lib/queue";

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const cfg = await getSmtp(user._id);
  return Response.json(cfg ? smtpOut(cfg) : null);
}

export async function PUT(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const b = await req.json();
  if (!b.host || !b.port || !b.from_email) {
    return Response.json({ error: "Host, port and from email are required" }, { status: 400 });
  }
  const existing = await getSmtp(user._id);
  await (await cols()).smtp.updateOne(
    { _id: user._id },
    {
      $set: {
        host: String(b.host).trim(),
        port: Number(b.port),
        secure: !!b.secure,
        username: String(b.username ?? "").trim(),
        // Empty password field means "keep the saved one".
        password: b.password ? String(b.password) : (existing?.password ?? ""),
        fromName: String(b.from_name ?? "").trim(),
        fromEmail: String(b.from_email).trim(),
        delayMs: Math.max(0, Number(b.delay_ms ?? 1000)),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
  kick(); // queued emails may have been waiting for SMTP config
  return Response.json({ ok: true });
}
