import { requireUser } from "@/lib/auth";
import { cols, oid } from "@/lib/db";
import { kick } from "@/lib/queue";

/** Body: { paused: boolean } */
export async function POST(req: Request, ctx: RouteContext<"/api/campaigns/[id]/pause">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = oid((await ctx.params).id);
  const { paused } = await req.json();
  const { campaigns, emails } = await cols();
  const r = id ? await campaigns.updateOne({ _id: id, userId: user._id }, { $set: { paused: !!paused } }) : null;
  if (!r?.matchedCount) return Response.json({ error: "Campaign not found" }, { status: 404 });
  // Emails carry a copy of the flag so the queue can skip them with one indexed query.
  await emails.updateMany({ campaignId: id! }, { $set: { paused: !!paused } });
  if (!paused) kick();
  return Response.json({ ok: true });
}
