import { requireUser } from "@/lib/auth";
import { cols, templateOut } from "@/lib/db";

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const list = await (await cols()).templates.find({ userId: user._id }).sort({ updatedAt: -1, _id: -1 }).toArray();
  return Response.json(list.map(templateOut));
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { name, subject, body } = await req.json();
  if (!name || !subject || !body) {
    return Response.json({ error: "Name, subject and body are required" }, { status: 400 });
  }
  const now = new Date();
  const r = await (await cols()).templates.insertOne({
    userId: user._id,
    name: String(name),
    subject: String(subject),
    body: String(body),
    createdAt: now,
    updatedAt: now,
  });
  return Response.json({ id: r.insertedId.toHexString() });
}
