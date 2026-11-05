import { requireUser } from "@/lib/auth";
import { cols, oid, type EmailStatus } from "@/lib/db";

const STATUSES = new Set<EmailStatus>(["pending", "sending", "sent", "failed"]);

/** Quote a CSV cell; neutralise spreadsheet formula injection (=, +, -, @ prefixes). */
function cell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** "2026-11-05 13:44:41" (UTC) — readable in spreadsheets. */
const utc = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 19) : "");

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "campaign";

/**
 * GET /api/campaigns/:id/report[?status=failed]
 * CSV with one row per recipient: delivery status + the original CSV columns.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/campaigns/[id]/report">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = oid((await ctx.params).id);
  const status = new URL(req.url).searchParams.get("status") as EmailStatus | null;
  if (status && !STATUSES.has(status)) return Response.json({ error: "Unknown status filter" }, { status: 400 });

  const { campaigns, emails } = await cols();
  const campaign = id ? await campaigns.findOne({ _id: id, userId: user._id }) : null;
  if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });

  const rows = await emails
    .find({ campaignId: campaign._id, ...(status ? { status } : {}) })
    .sort({ _id: 1 })
    .toArray();

  // Union of original CSV columns (minus the email column, which is already first).
  const extra = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.data ?? {})) if (k.toLowerCase() !== "email") extra.add(k);
  const extraCols = [...extra];

  const header = ["email", "status", "attempts", "sent_at_utc", "last_updated_utc", "error", ...extraCols];
  const lines = [header.map(cell).join(",")];
  for (const r of rows) {
    lines.push(
      [r.to, r.status, r.attempts, utc(r.sentAt), utc(r.updatedAt), r.error ?? "", ...extraCols.map((k) => r.data?.[k] ?? "")]
        .map(cell)
        .join(","),
    );
  }

  const date = campaign.createdAt.toISOString().slice(0, 10);
  const filename = `campaign-${slug(campaign.name)}-${date}${status ? `-${status}` : ""}-report.csv`;
  // BOM so Excel opens UTF-8 correctly.
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
