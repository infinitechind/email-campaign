"use client";

import Papa from "papaparse";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { placeholders, render } from "@/lib/render";
import { api, Button, Callout, Card, EmailPreview, Field, Icon, inputCls, PageHeader, useUi } from "./common";
import type { Template } from "./TemplatesPanel";
import SendTestEmail from "./SendTestEmail";

type Parsed = { fields: string[]; rows: Record<string, string>[] };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SendPanel({
  smtpReady,
  onQueued,
  onGo,
}: {
  smtpReady: boolean;
  onQueued: (campaignId: string) => void;
  onGo: (tab: "smtp" | "templates") => void;
}) {
  const { toast, confirm } = useUi();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    api<Template[]>("/api/templates").then((t) => {
      setTemplates(t);
      if (t[0]) setTemplateId(t[0].id);
    });
  }, []);

  function onFile(f: File | null) {
    setFile(f);
    setParsed(null);
    setPreviewIdx(0);
    if (!f) return;
    Papa.parse<Record<string, string>>(f, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (r) => setParsed({ fields: r.meta.fields ?? [], rows: r.data }),
    });
  }

  const tpl = templates?.find((t) => t.id === templateId);
  const emailKey = parsed?.fields.find((f) => f.toLowerCase() === "email");

  const stats = useMemo(() => {
    if (!parsed || !emailKey) return null;
    const seen = new Set<string>();
    let invalid = 0,
      dupes = 0;
    for (const r of parsed.rows) {
      const e = (r[emailKey] ?? "").trim().toLowerCase();
      if (!EMAIL_RE.test(e)) invalid++;
      else if (seen.has(e)) dupes++;
      else seen.add(e);
    }
    return { valid: seen.size, invalid, dupes };
  }, [parsed, emailKey]);

  const missingVars = useMemo(() => {
    if (!tpl || !parsed) return [];
    const cols = new Set(parsed.fields.map((f) => f.toLowerCase()));
    return placeholders(tpl.subject, tpl.body).filter((v) => !cols.has(v.toLowerCase()));
  }, [tpl, parsed]);

  const row = parsed?.rows[previewIdx];
  const replyToValid = !replyTo.trim() || replyTo.split(",").every((a) => EMAIL_RE.test(a.trim()));
  const ready = !!tpl && !!stats && stats.valid > 0 && replyToValid;

  async function send() {
    if (!file || !tpl || !stats) return;
    const ok = await confirm({
      title: `Send ${stats.valid.toLocaleString()} emails?`,
      confirmLabel: "Start sending",
      body: (
        <div className="space-y-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900">
            <dt className="text-zinc-500">Template</dt>
            <dd className="font-medium">{tpl.name}</dd>
            <dt className="text-zinc-500">Reply-To</dt>
            <dd className="font-medium">{replyTo.trim() || <span className="font-normal text-zinc-500">Sender address</span>}</dd>
            <dt className="text-zinc-500">Recipients</dt>
            <dd className="font-medium">{stats.valid.toLocaleString()}</dd>
            {stats.invalid + stats.dupes > 0 && (
              <>
                <dt className="text-zinc-500">Skipped</dt>
                <dd>
                  {stats.invalid} invalid, {stats.dupes} duplicate
                </dd>
              </>
            )}
          </dl>
          <p>Emails are queued and sent one at a time. You can pause or retry failures from the Campaigns page.</p>
        </div>
      ),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("templateId", String(tpl.id));
      fd.append("name", name);
      fd.append("replyTo", replyTo.trim());
      const r = await api<{ id: string; queued: number; invalid: string[] }>("/api/campaigns", { method: "POST", body: fd });
      toast("ok", `${r.queued.toLocaleString()} emails queued`, r.invalid.length ? `${r.invalid.length} invalid address(es) skipped.` : undefined);
      onQueued(r.id);
    } catch (err) {
      toast("err", "Could not start campaign", (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="New Campaign" description="Choose a template, upload recipients and send." />

      {!smtpReady && (
        <div className="mb-6">
          <Callout tone="amber">
            SMTP isn&apos;t configured yet — emails will wait in the queue until you{" "}
            <button className="font-medium underline" onClick={() => onGo("smtp")}>
              add SMTP settings
            </button>
            .
          </Callout>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {/* Step 1 */}
          <Step n={1} title="Choose a template" done={!!tpl}>
            {templates && templates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm dark:border-zinc-700">
                <p className="text-zinc-500">You don&apos;t have any templates yet.</p>
                <Button variant="secondary" icon="plus" className="mt-3" onClick={() => onGo("templates")}>
                  Create a template
                </Button>
              </div>
            ) : (
              <div className="grid max-h-64 gap-2 overflow-auto sm:grid-cols-2">
                {templates?.map((t) => {
                  const active = t.id === templateId;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTemplateId(t.id)}
                      className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${
                        active
                          ? "border-indigo-500 bg-indigo-50/60 ring-4 ring-indigo-500/10 dark:bg-indigo-500/10"
                          : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                      }`}
                    >
                      <span
                        className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                          active ? "border-indigo-600 bg-indigo-600 text-white" : "border-zinc-300 dark:border-zinc-600"
                        }`}
                      >
                        {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{t.name}</span>
                        <span className="block truncate text-xs text-zinc-500">{t.subject}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </Step>

          {/* Step 2 */}
          <Step n={2} title="Upload recipients" done={!!stats && stats.valid > 0}>
            {!file ? (
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  onFile(e.dataTransfer.files[0] ?? null);
                }}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
                  drag ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10" : "border-zinc-300 hover:border-indigo-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                }`}
              >
                <span className="mb-3 rounded-xl bg-indigo-100 p-2.5 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
                  <Icon name="upload" className="h-5 w-5" />
                </span>
                <span className="text-sm font-medium">
                  Drop your CSV here or <span className="text-indigo-600 dark:text-indigo-400">browse</span>
                </span>
                <span className="mt-1 text-xs text-zinc-500">Needs an “email” column. Other columns fill {"{{placeholders}}"}.</span>
                <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
              </label>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                  <span className="rounded-lg bg-emerald-100 p-2 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                    <Icon name="file" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-zinc-500">
                      {(file.size / 1024).toFixed(1)} KB · {parsed?.rows.length ?? "…"} rows
                    </p>
                  </div>
                  <Button variant="ghost" icon="x" onClick={() => onFile(null)} aria-label="Remove file" />
                </div>

                {parsed && !emailKey && <Callout tone="red">No “email” column found. Columns: {parsed.fields.join(", ") || "none"}.</Callout>}

                {stats && (
                  <div className="grid grid-cols-3 gap-2">
                    <Stat label="Will send" value={stats.valid} tone="text-emerald-600" />
                    <Stat label="Invalid" value={stats.invalid} tone={stats.invalid ? "text-rose-600" : ""} />
                    <Stat label="Duplicates" value={stats.dupes} tone={stats.dupes ? "text-amber-600" : ""} />
                  </div>
                )}

                {missingVars.length > 0 && (
                  <Callout tone="amber">
                    Template uses {missingVars.map((v) => `{{${v}}}`).join(", ")} but the CSV has no matching column — it will be left as-is.
                  </Callout>
                )}

                {parsed && parsed.rows.length > 0 && (
                  <div className="overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
                        <tr>
                          {parsed.fields.map((f) => (
                            <th key={f} className="px-3 py-2 font-medium whitespace-nowrap">
                              {f}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {parsed.rows.slice(0, 5).map((r, i) => (
                          <tr
                            key={i}
                            onClick={() => setPreviewIdx(i)}
                            className={`cursor-pointer border-t border-zinc-100 dark:border-zinc-800 ${
                              i === previewIdx ? "bg-indigo-50/60 dark:bg-indigo-500/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                            }`}
                          >
                            {parsed.fields.map((f) => (
                              <td key={f} className="max-w-[180px] truncate px-3 py-2">
                                {r[f]}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {parsed.rows.length > 5 && (
                      <p className="border-t border-zinc-100 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800">
                        + {(parsed.rows.length - 5).toLocaleString()} more rows
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </Step>

          {/* Step 3 */}
          <Step n={3} title="Review & send" done={false} last>
            <div className="space-y-4">
              <Field label="Campaign name (optional)">
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={tpl ? `${tpl.name} – ${new Date().toLocaleDateString()}` : "November newsletter"} />
              </Field>
              <Field
                label="Reply-To (optional)"
                hint={
                  replyToValid ? (
                    "Where replies go. Leave blank to use the sender address. Separate multiple addresses with commas."
                  ) : (
                    <span className="text-rose-600">Enter a valid email address (or comma-separated addresses).</span>
                  )
                }
              >
                <input
                  className={`${inputCls} ${replyToValid ? "" : "border-rose-400 focus:border-rose-500 focus:ring-rose-500/10"}`}
                  type="text"
                  inputMode="email"
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                  placeholder="support@acme.com"
                />
              </Field>
              <Button onClick={send} loading={busy} icon="send" disabled={!ready} className="w-full py-2.5">
                {stats?.valid ? `Send to ${stats.valid.toLocaleString()} recipients` : "Send campaign"}
              </Button>
            </div>
          </Step>
        </div>

        {/* Preview */}
        <div className="xl:sticky xl:top-10 xl:self-start">
          <Card
            title="Preview"
            description={row && emailKey ? `Recipient ${previewIdx + 1} of ${parsed!.rows.length.toLocaleString()}` : "Upload a CSV to preview real recipients"}
            actions={
              <>
                {tpl && (
                  <SendTestEmail
                    subject={tpl.subject}
                    body={tpl.body}
                    data={row ?? {}}
                    dataLabel={row ? `CSV row ${previewIdx + 1}${emailKey && row[emailKey] ? ` (${row[emailKey]})` : ""}` : "no CSV row yet"}
                    replyTo={replyToValid ? replyTo.trim() || undefined : undefined}
                  />
                )}
                {parsed && parsed.rows.length > 1 ? (
                <div className="flex items-center gap-1">
                  <Button variant="secondary" icon="chevronLeft" aria-label="Previous" disabled={previewIdx === 0} onClick={() => setPreviewIdx((i) => i - 1)} className="px-2" />
                  <Button
                    variant="secondary"
                    icon="chevronRight"
                    aria-label="Next"
                    disabled={previewIdx >= parsed.rows.length - 1}
                    onClick={() => setPreviewIdx((i) => i + 1)}
                    className="px-2"
                  />
                </div>
                ) : null}
              </>
            }
          >
            {tpl ? (
              <EmailPreview
                replyTo={replyToValid ? replyTo.trim() || undefined : undefined}
                to={row && emailKey ? row[emailKey] : undefined} subject={render(tpl.subject, row ?? {})} html={render(tpl.body, row ?? {}, true)} />
            ) : (
              <p className="py-10 text-center text-sm text-zinc-500">Select a template to see a preview.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Step({ n, title, done, last, children }: { n: number; title: string; done: boolean; last?: boolean; children: ReactNode }) {
  return (
    <div className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold transition ${
            done ? "bg-emerald-500 text-white" : "bg-white text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700"
          }`}
        >
          {done ? <Icon name="check" className="h-4 w-4" /> : n}
        </span>
        {!last && <span className={`mt-2 w-px flex-1 ${done ? "bg-emerald-300 dark:bg-emerald-800" : "bg-zinc-200 dark:bg-zinc-800"}`} />}
      </div>
      <div className="min-w-0 flex-1 pb-2">
        <h3 className="mb-3 pt-1 text-sm font-semibold">{title}</h3>
        <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">{children}</div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl bg-zinc-50 px-3 py-2.5 dark:bg-zinc-900">
      <p className={`text-xl font-semibold tabular-nums ${tone}`}>{value.toLocaleString()}</p>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  );
}
