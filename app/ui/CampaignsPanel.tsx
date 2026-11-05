"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, Badge, Button, Card, EmptyState, Icon, inputCls, json, PageHeader, useUi, type Tone } from "./common";

type CampaignSummary = {
  id: string;
  name: string;
  subject: string;
  reply_to: string | null;
  paused: number;
  created_at: string;
  total: number;
  sent: number | null;
  failed: number | null;
  pending: number | null;
};
type EmailRow = {
  id: string;
  to_email: string;
  status: "pending" | "sending" | "sent" | "failed";
  error: string | null;
  attempts: number;
  sent_at: string | null;
};
type Filter = "all" | EmailRow["status"];

const STATUS_TONE: Record<EmailRow["status"], Tone> = { pending: "zinc", sending: "indigo", sent: "green", failed: "red" };

function campaignState(c: CampaignSummary): { label: string; tone: Tone } {
  if ((c.pending ?? 0) > 0) return c.paused ? { label: "Paused", tone: "amber" } : { label: "Sending", tone: "indigo" };
  if ((c.failed ?? 0) > 0) return { label: "Needs attention", tone: "red" };
  return { label: "Completed", tone: "green" };
}

const fmtDate = (s: string) => new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function CampaignsPanel({ initialId, onNew }: { initialId: string | null; onNew: () => void }) {
  const { toast, confirm } = useUi();
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initialId);
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await api<CampaignSummary[]>("/api/campaigns");
    setCampaigns(list);
    const id = selected && list.some((c) => c.id === selected) ? selected : (list[0]?.id ?? null);
    if (id !== selected) setSelected(id);
    if (id) {
      const d = await api<{ emails: EmailRow[] }>(`/api/campaigns/${id}`).catch(() => ({ emails: [] }));
      setEmails(d.emails);
    } else setEmails([]);
  }, [selected]);

  // Poll so progress updates live while the queue works.
  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, 2000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);

  const current = campaigns?.find((c) => c.id === selected);

  async function retryOne(e: EmailRow) {
    await api(`/api/emails/${e.id}/retry`, { method: "POST" });
    toast("info", "Re-queued", e.to_email);
    refresh();
  }
  async function retryAll() {
    if (!current) return;
    const ok = await confirm({
      title: `Retry ${current.failed} failed email${current.failed === 1 ? "" : "s"}?`,
      body: "They'll go back to the end of the queue and be sent again.",
      confirmLabel: "Retry all",
    });
    if (!ok) return;
    const r = await api<{ requeued: number }>(`/api/campaigns/${current.id}/retry`, { method: "POST" });
    toast("info", `${r.requeued} email(s) re-queued`);
    refresh();
  }
  async function togglePause() {
    if (!current) return;
    await api(`/api/campaigns/${current.id}/pause`, json("POST", { paused: !current.paused }));
    toast("info", current.paused ? "Campaign resumed" : "Campaign paused");
    refresh();
  }
  async function remove() {
    if (!current) return;
    const ok = await confirm({
      title: "Delete campaign?",
      body: (
        <>
          <b>{current.name}</b> and its {current.total.toLocaleString()} queued/sent records will be removed. Emails already sent can&apos;t be recalled.
        </>
      ),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await api(`/api/campaigns/${current.id}`, { method: "DELETE" });
    toast("ok", "Campaign deleted");
    setSelected(null);
  }

  const counts = {
    all: emails.length,
    pending: emails.filter((e) => e.status === "pending").length,
    sending: emails.filter((e) => e.status === "sending").length,
    sent: emails.filter((e) => e.status === "sent").length,
    failed: emails.filter((e) => e.status === "failed").length,
  };
  const shown = emails.filter((e) => (filter === "all" || e.status === filter) && e.to_email.toLowerCase().includes(query.toLowerCase()));

  if (campaigns && campaigns.length === 0) {
    return (
      <>
        <PageHeader title="Campaigns" description="Track delivery, pause sending and retry failures." />
        <Card>
          <EmptyState icon="send" title="No campaigns yet">
            <p>Start a campaign to see its queue and delivery status here.</p>
            <Button icon="plus" className="mt-4" onClick={onNew}>
              New campaign
            </Button>
          </EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Track delivery, pause sending and retry failures."
        actions={
          <Button icon="plus" onClick={onNew}>
            New campaign
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <div className="space-y-2 self-start lg:max-h-[calc(100vh-12rem)] lg:overflow-auto lg:pr-1">
          {campaigns?.map((c) => {
            const st = campaignState(c);
            const active = c.id === selected;
            return (
              <button
                key={c.id}
                onClick={() => {
                  setSelected(c.id);
                  setFilter("all");
                  setQuery("");
                }}
                className={`w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition dark:bg-zinc-950 ${
                  active ? "border-indigo-500 ring-4 ring-indigo-500/10" : "border-zinc-200/80 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  <Badge tone={st.tone} dot>
                    {st.label}
                  </Badge>
                </div>
                <ProgressBar c={c} className="mt-3 h-1.5" />
                <div className="mt-2 flex justify-between text-xs text-zinc-500">
                  <span>
                    {(c.sent ?? 0).toLocaleString()}/{c.total.toLocaleString()} sent
                  </span>
                  {(c.failed ?? 0) > 0 && <span className="text-rose-600">{c.failed} failed</span>}
                </div>
              </button>
            );
          })}
        </div>

        {current && (
          <div className="min-w-0 space-y-6">
            <Card
              title={
                <span className="flex items-center gap-2">
                  {current.name}
                  <Badge tone={campaignState(current).tone} dot>
                    {campaignState(current).label}
                  </Badge>
                </span>
              }
              description={
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  <span>“{current.subject}”</span>
                  <span className="inline-flex items-center gap-1">
                    <Icon name="retry" className="h-3.5 w-3.5 -scale-x-100" />
                    Reply-To: {current.reply_to || <span className="italic">sender address</span>}
                  </span>
                  <span>Created {fmtDate(current.created_at)}</span>
                </span>
              }
              actions={
                <>
                  {(current.pending ?? 0) > 0 && (
                    <Button variant="secondary" icon={current.paused ? "play" : "pause"} onClick={togglePause}>
                      {current.paused ? "Resume" : "Pause"}
                    </Button>
                  )}
                  <ReportMenu campaignId={current.id} total={current.total} sent={current.sent ?? 0} failed={current.failed ?? 0} />
                  {(current.failed ?? 0) > 0 && (
                    <Button icon="retry" onClick={retryAll}>
                      Retry failed ({current.failed})
                    </Button>
                  )}
                  <Button variant="ghost" icon="trash" onClick={remove} aria-label="Delete campaign" className="text-rose-600 dark:text-rose-400" />
                </>
              }
            >
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard label="Recipients" value={current.total} icon="user" />
                <StatCard label="Sent" value={current.sent ?? 0} icon="check" tone="text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10" />
                <StatCard label="Failed" value={current.failed ?? 0} icon="alert" tone="text-rose-600 bg-rose-50 dark:bg-rose-500/10" />
                <StatCard label="In queue" value={current.pending ?? 0} icon="clock" tone="text-indigo-600 bg-indigo-50 dark:bg-indigo-500/10" />
              </div>
              <div className="mt-5">
                <div className="mb-1.5 flex justify-between text-xs text-zinc-500">
                  <span>Progress</span>
                  <span className="tabular-nums">
                    {current.total ? Math.round((((current.sent ?? 0) + (current.failed ?? 0)) / current.total) * 100) : 0}% processed
                  </span>
                </div>
                <ProgressBar c={current} className="h-2.5" animated={(current.pending ?? 0) > 0 && !current.paused} />
              </div>
            </Card>

            <Card padded={false}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 p-3 dark:border-zinc-800">
                <div className="flex flex-wrap gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
                  {(["all", "pending", "sending", "sent", "failed"] as Filter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition ${
                        filter === f ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      }`}
                    >
                      {f} <span className="ml-0.5 text-zinc-400 tabular-nums">{counts[f]}</span>
                    </button>
                  ))}
                </div>
                <div className="relative w-full sm:w-64">
                  <Icon name="search" className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input className={`${inputCls} pl-9`} placeholder="Search recipients" value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
              </div>

              <div className="max-h-[55vh] overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-white/95 text-xs text-zinc-500 backdrop-blur dark:bg-zinc-950/95">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Recipient</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="hidden px-4 py-2.5 font-medium md:table-cell">Attempts</th>
                      <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Details</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                    {shown.map((e) => (
                      <tr key={e.id} className="group hover:bg-zinc-50/70 dark:hover:bg-zinc-900/50">
                        <td className="max-w-[240px] truncate px-4 py-2.5 font-medium">{e.to_email}</td>
                        <td className="px-4 py-2.5">
                          <Badge tone={STATUS_TONE[e.status]} dot>
                            {e.status === "sending" ? "sending…" : e.status}
                          </Badge>
                        </td>
                        <td className="hidden px-4 py-2.5 text-zinc-500 tabular-nums md:table-cell">{e.attempts}</td>
                        <td className="hidden max-w-xs px-4 py-2.5 text-xs sm:table-cell">
                          {e.status === "failed" && e.error ? (
                            <button
                              onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                              className={`text-left text-rose-600 dark:text-rose-400 ${expanded === e.id ? "break-words" : "line-clamp-1"}`}
                              title="Click to expand"
                            >
                              {e.error}
                            </button>
                          ) : e.sent_at ? (
                            <span className="text-zinc-500">{fmtDate(e.sent_at)}</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {e.status === "failed" && (
                            <Button variant="secondary" icon="retry" className="px-2.5 py-1 text-xs" onClick={() => retryOne(e)}>
                              Retry
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {shown.length === 0 && (
                  <EmptyState icon={filter === "failed" ? "check" : "mail"} title={filter === "failed" ? "No failures" : "Nothing here"}>
                    {query ? "Try a different search." : filter === "failed" ? "Every email was delivered successfully." : undefined}
                  </EmptyState>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}

function ReportMenu({ campaignId, total, sent, failed }: { campaignId: string; total: number; sent: number; failed: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const base = `/api/campaigns/${campaignId}/report`;
  const items = [
    { label: "All recipients", hint: "Full delivery report", count: total, href: base },
    { label: "Sent only", hint: "Successfully delivered", count: sent, href: `${base}?status=sent` },
    { label: "Failed only", hint: "Includes error details", count: failed, href: `${base}?status=failed` },
  ];

  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" icon="download" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        Report
        <Icon name="chevronDown" className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} />
      </Button>
      {open && (
        <div
          role="menu"
          className="animate-pop-in absolute left-0 z-20 mt-2 w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
        >
          <p className="px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-zinc-500 uppercase">Download CSV</p>
          {items.map((it) =>
            it.count > 0 ? (
              <a
                key={it.label}
                role="menuitem"
                href={it.href}
                download
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <Icon name="download" className="h-4 w-4 text-zinc-400" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{it.label}</span>
                  <span className="block truncate text-xs text-zinc-500">{it.hint}</span>
                </span>
                <span className="text-xs text-zinc-400 tabular-nums">{it.count.toLocaleString()}</span>
              </a>
            ) : (
              <div key={it.label} className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm opacity-40">
                <Icon name="download" className="h-4 w-4" />
                <span className="flex-1 font-medium">{it.label}</span>
                <span className="text-xs tabular-nums">0</span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function ProgressBar({ c, className = "", animated }: { c: CampaignSummary; className?: string; animated?: boolean }) {
  const pct = (n: number | null) => (c.total ? ((n ?? 0) / c.total) * 100 : 0);
  return (
    <div className={`flex overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800 ${className}`}>
      <div className={`bg-emerald-500 transition-all duration-500 ${animated ? "animate-pulse" : ""}`} style={{ width: `${pct(c.sent)}%` }} />
      <div className="bg-rose-500 transition-all duration-500" style={{ width: `${pct(c.failed)}%` }} />
    </div>
  );
}

function StatCard({ label, value, icon, tone = "text-zinc-600 bg-zinc-100 dark:bg-zinc-900" }: { label: string; value: number; icon: "user" | "check" | "alert" | "clock"; tone?: string }) {
  return (
    <div className="rounded-xl border border-zinc-100 p-3.5 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">{label}</p>
        <span className={`rounded-lg p-1.5 ${tone}`}>
          <Icon name={icon} className="h-3.5 w-3.5" />
        </span>
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}
