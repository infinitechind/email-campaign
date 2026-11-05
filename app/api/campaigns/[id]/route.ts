import { requireUser } from "@/lib/auth";
import { cols, emailOut, iso, oid } from "@/lib/db";

const notFound = () => Response.json({ error: "Campaign not found" }, { status: 404 });

export async function GET(_req: Request, ctx: RouteContext<"/api/campaigns/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = oid((await ctx.params).id);
  if (!id) return notFound();
  const { campaigns, emails } = await cols();
  const c = await campaigns.findOne({ _id: id, userId: user._id });
  if (!c) return notFound();
  const list = await emails
    .find({ campaignId: id }, { projection: { data: 0 } })
    .sort({ _id: 1 })
    .toArray();
  return Response.json({
    campaign: {
      id: c._id.toHexString(),
      name: c.name,
      subject: c.subject,
      body: c.body,
      reply_to: c.replyTo,
      paused: c.paused ? 1 : 0,
      created_at: iso(c.createdAt),
    },
    emails: list.map(emailOut),
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/campaigns/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = oid((await ctx.params).id);
  if (!id) return notFound();
  const { campaigns, emails } = await cols();
  const r = await campaigns.deleteOne({ _id: id, userId: user._id });
  if (!r.deletedCount) return notFound();
  await emails.deleteMany({ campaignId: id });
  return Response.json({ ok: true });
}
