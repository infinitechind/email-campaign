import { requireUser } from "@/lib/auth";
import { cols, oid } from "@/lib/db";

const notFound = () => Response.json({ error: "Template not found" }, { status: 404 });

export async function PUT(req: Request, ctx: RouteContext<"/api/templates/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = oid((await ctx.params).id);
  if (!id) return notFound();
  const { name, subject, body } = await req.json();
  if (!name || !subject || !body) {
    return Response.json({ error: "Name, subject and body are required" }, { status: 400 });
  }
  const r = await (await cols()).templates.updateOne(
    { _id: id, userId: user._id },
    { $set: { name: String(name), subject: String(subject), body: String(body), updatedAt: new Date() } },
  );
  return r.matchedCount ? Response.json({ ok: true }) : notFound();
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/templates/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = oid((await ctx.params).id);
  if (!id) return notFound();
  const r = await (await cols()).templates.deleteOne({ _id: id, userId: user._id });
  return r.deletedCount ? Response.json({ ok: true }) : notFound();
}
