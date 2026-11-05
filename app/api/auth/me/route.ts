import { requireUser } from "@/lib/auth";

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id, email, name, picture } = user;
  return Response.json({ id, email, name, picture });
}
