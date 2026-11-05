import { requireUser } from "@/lib/auth";
import { cols, oid } from "@/lib/db";
import { kick } from "@/lib/queue";

/** Re-queue a single failed email. */
export async function POST(_req: Request, ctx: RouteContext<"/api/emails/[id]/retry">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = oid((await ctx.params).id);
  if (!id) return Response.json({ requeued: 0 });
  const r = await (await cols()).emails.updateOne(
    { _id: id, userId: user._id, status: "failed" },
    { $set: { status: "pending", error: null, updatedAt: new Date() } },
  );
  kick();
  return Response.json({ requeued: r.modifiedCount });
}
