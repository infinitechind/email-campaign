import Papa from "papaparse";
import { requireUser } from "@/lib/auth";
import { cols, iso, oid, type EmailFields, type ObjectId } from "@/lib/db";
import { kick } from "@/lib/queue";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INSERT_BATCH = 1000;

/** Accepts `a@b.com` or a comma-separated list of addresses. */
const validReplyTo = (v: string) => v.split(",").every((a) => EMAIL_RE.test(a.trim()));

type Counts = { _id: ObjectId; total: number; sent: number; failed: number; pending: number };
const countIf = (cond: unknown) => ({ $sum: { $cond: [cond, 1, 0] } });

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { campaigns, emails } = await cols();
  const list = await campaigns.find({ userId: user._id }).sort({ _id: -1 }).toArray();
  const counts = await emails
    .aggregate<Counts>([
      { $match: { campaignId: { $in: list.map((c) => c._id) } } },
      {
        $group: {
          _id: "$campaignId",
          total: { $sum: 1 },
          sent: countIf({ $eq: ["$status", "sent"] }),
          failed: countIf({ $eq: ["$status", "failed"] }),
          pending: countIf({ $in: ["$status", ["pending", "sending"]] }),
        },
      },
    ])
    .toArray();
  const byId = new Map(counts.map((c) => [c._id.toHexString(), c]));

  return Response.json(
    list.map((c) => {
      const n = byId.get(c._id.toHexString());
      return {
        id: c._id.toHexString(),
        name: c.name,
        subject: c.subject,
        reply_to: c.replyTo,
        paused: c.paused ? 1 : 0,
        created_at: iso(c.createdAt),
        total: n?.total ?? 0,
        sent: n?.sent ?? 0,
        failed: n?.failed ?? 0,
        pending: n?.pending ?? 0,
      };
    }),
  );
}

/** multipart/form-data: file (CSV with an `email` column), templateId, name, replyTo */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const form = await req.formData();
  const file = form.get("file");
  const templateId = oid(String(form.get("templateId") ?? ""));
  const name = String(form.get("name") ?? "").trim();
  const replyTo = String(form.get("replyTo") ?? "").trim();

  if (replyTo && !validReplyTo(replyTo)) {
    return Response.json({ error: "Reply-To must be a valid email address" }, { status: 400 });
  }
  if (!(file instanceof File)) return Response.json({ error: "CSV file is required" }, { status: 400 });
  const { templates, campaigns, emails } = await cols();
  const tpl = templateId ? await templates.findOne({ _id: templateId, userId: user._id }) : null;
  if (!tpl) return Response.json({ error: "Select a template" }, { status: 400 });

  const parsed = Papa.parse<Record<string, string>>(await file.text(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const emailKey = parsed.meta.fields?.find((f) => f.toLowerCase() === "email");
  if (!emailKey) {
    return Response.json({ error: 'CSV must have a header row with an "email" column' }, { status: 400 });
  }

  const seen = new Set<string>();
  const valid: Record<string, string>[] = [];
  const invalid: string[] = [];
  for (const row of parsed.data) {
    const email = (row[emailKey] ?? "").trim();
    if (!EMAIL_RE.test(email)) {
      if (email) invalid.push(email);
      continue;
    }
    if (seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    valid.push({ ...row, [emailKey]: email });
  }
  if (valid.length === 0) return Response.json({ error: "No valid email addresses found" }, { status: 400 });

  // Snapshot subject/body so later template edits don't change an in-flight campaign.
  const now = new Date();
  const { insertedId: campaignId } = await campaigns.insertOne({
    userId: user._id,
    templateId: tpl._id,
    name: name || `${tpl.name} – ${now.toLocaleString()}`,
    subject: tpl.subject,
    body: tpl.body,
    replyTo: replyTo || null,
    paused: false,
    createdAt: now,
  });

  // Insert emails held (paused) so the queue can't start on a half-written campaign, then release them.
  // Standalone MongoDB has no multi-document transactions, so clean up by hand on failure.
  try {
    for (let i = 0; i < valid.length; i += INSERT_BATCH) {
      const docs: EmailFields[] = valid.slice(i, i + INSERT_BATCH).map((row) => ({
        campaignId,
        userId: user._id,
        paused: true,
        to: row[emailKey],
        data: row,
        status: "pending",
        error: null,
        attempts: 0,
        sentAt: null,
        updatedAt: now,
      }));
      await emails.insertMany(docs, { ordered: false });
    }
    await emails.updateMany({ campaignId }, { $set: { paused: false } });
  } catch (err) {
    await emails.deleteMany({ campaignId }).catch(() => {});
    await campaigns.deleteOne({ _id: campaignId }).catch(() => {});
    throw err;
  }

  kick();
  return Response.json({ id: campaignId.toHexString(), queued: valid.length, invalid });
}
