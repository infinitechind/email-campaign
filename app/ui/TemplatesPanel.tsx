"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { placeholders, render } from "@/lib/render";
import SendTestEmail from "./SendTestEmail";
import { api, Badge, Button, Card, EmailPreview, Field, Icon, inputCls, json, PageHeader, useUi } from "./common";

export type Template = { id: string; name: string; subject: string; body: string; updated_at: string };
type Form = { name: string; subject: string; body: string };

const STARTER: Form = {
  name: "",
  subject: "Hello {{name}} 👋",
  body: `<div style="font-family: -apple-system, Segoe UI, Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h2 style="margin: 0 0 16px; color: #111827;">Hi {{name}},</h2>
  <p>We wanted to reach out to the team at <strong>{{company}}</strong>.</p>
  <p>
    <a href="https://example.com" style="display: inline-block; background: #4f46e5; color: #fff; padding: 10px 18px; border-radius: 8px; text-decoration: none;">Learn more</a>
  </p>
  <p style="color: #6b7280;">Regards,<br/>The Team</p>
</div>`,
};

const COMMON_VARS = ["name", "email", "company"];

export default function TemplatesPanel() {
  const { toast, confirm } = useUi();
  const [list, setList] = useState<Template[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(STARTER);
  const [savedForm, setSavedForm] = useState<Form | null>(null);
  const [sample, setSample] = useState<Record<string, string>>({ name: "Alex", company: "Acme Inc.", email: "alex@acme.com" });
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastField = useRef<"subject" | "body">("body");
  const subjectRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    () =>
      api<Template[]>("/api/templates").then((t) => {
        setList(t);
        setLoaded(true);
      }),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  const vars = useMemo(() => placeholders(form.subject, form.body), [form.subject, form.body]);
  const dirty = savedForm ? JSON.stringify(savedForm) !== JSON.stringify(form) : form.name !== "" || form.body !== STARTER.body || form.subject !== STARTER.subject;
  const filtered = list.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()));

  async function edit(t: Template | null) {
    if (dirty && !(await confirm({ title: "Discard changes?", body: "You have unsaved changes to this template.", confirmLabel: "Discard", danger: true }))) return;
    const f = t ? { name: t.name, subject: t.subject, body: t.body } : STARTER;
    setEditingId(t?.id ?? null);
    setForm(f);
    setSavedForm(t ? f : null);
  }

  async function save() {
    setBusy(true);
    try {
      if (editingId) await api(`/api/templates/${editingId}`, json("PUT", form));
      else setEditingId((await api<{ id: string }>("/api/templates", json("POST", form))).id);
      setSavedForm(form);
      await load();
      toast("ok", "Template saved", form.name);
    } catch (err) {
      toast("err", "Could not save template", (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editingId) return;
    const ok = await confirm({
      title: "Delete template?",
      body: (
        <>
          <b>{form.name}</b> will be permanently deleted. Existing campaigns keep their own copy.
        </>
      ),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await api(`/api/templates/${editingId}`, { method: "DELETE" });
    setEditingId(null);
    setForm(STARTER);
    setSavedForm(null);
    load();
    toast("ok", "Template deleted");
  }

  /** Insert {{var}} at the cursor of the last focused field. */
  function insertVar(v: string) {
    const tag = `{{${v}}}`;
    const el = lastField.current === "subject" ? subjectRef.current : bodyRef.current;
    const key = lastField.current;
    if (!el) return;
    const start = el.selectionStart ?? form[key].length;
    const end = el.selectionEnd ?? start;
    setForm((f) => ({ ...f, [key]: f[key].slice(0, start) + tag + f[key].slice(end) }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + tag.length, start + tag.length);
    });
  }

  const sampleData = Object.fromEntries(vars.map((v) => [v, sample[v] || `[${v}]`]));
  const chips = [...new Set([...COMMON_VARS, ...vars])];

  return (
    <>
      <PageHeader
        title="Templates"
        description="Write reusable emails with {{placeholders}} filled from your CSV columns."
        actions={
          <Button icon="plus" onClick={() => edit(null)}>
            New template
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card padded={false} className="self-start">
          <div className="border-b border-zinc-100 p-3 dark:border-zinc-800">
            <div className="relative">
              <Icon name="search" className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input className={`${inputCls} pl-9`} placeholder="Search templates" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
          <ul className="max-h-[60vh] space-y-0.5 overflow-auto p-2">
            {filtered.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => edit(t)}
                  className={`w-full rounded-lg px-3 py-2 text-left transition ${
                    editingId === t.id ? "bg-indigo-50 dark:bg-indigo-500/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  }`}
                >
                  <span className={`block truncate text-sm font-medium ${editingId === t.id ? "text-indigo-700 dark:text-indigo-300" : ""}`}>{t.name}</span>
                  <span className="block truncate text-xs text-zinc-500">{t.subject}</span>
                </button>
              </li>
            ))}
            {loaded && filtered.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-zinc-500">{list.length ? "No matches" : "No templates yet"}</li>
            )}
          </ul>
        </Card>

        <div className="min-w-0 space-y-6">
          <Card
            title={
              <span className="flex items-center gap-2">
                {editingId ? form.name || "Untitled" : "New template"}
                {dirty && <Badge tone="amber">Unsaved</Badge>}
              </span>
            }
            actions={
              <>
                {editingId && (
                  <Button variant="ghost" icon="trash" onClick={remove} className="text-rose-600 dark:text-rose-400">
                    Delete
                  </Button>
                )}
                <SendTestEmail subject={form.subject} body={form.body} data={sampleData} dataLabel="your sample values" />
                <Button icon="check" onClick={save} loading={busy} disabled={!form.name || !form.subject || !form.body || !dirty}>
                  Save
                </Button>
              </>
            }
          >
            <div className="grid gap-6 2xl:grid-cols-2">
              <div className="space-y-4">
                <Field label="Template name">
                  <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Product launch" />
                </Field>
                <Field label="Subject line">
                  <input
                    ref={subjectRef}
                    className={inputCls}
                    value={form.subject}
                    onFocus={() => (lastField.current = "subject")}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  />
                </Field>
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-xs font-medium tracking-wide text-zinc-600 uppercase dark:text-zinc-400">Insert</span>
                    {chips.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => insertVar(v)}
                        className="rounded-md border border-dashed border-indigo-300 bg-indigo-50/50 px-2 py-0.5 font-mono text-xs text-indigo-700 transition hover:border-solid hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-300"
                      >
                        {`{{${v}}}`}
                      </button>
                    ))}
                  </div>
                  <textarea
                    ref={bodyRef}
                    spellCheck={false}
                    className={`${inputCls} h-80 resize-y bg-zinc-50 font-mono text-xs leading-relaxed dark:bg-zinc-900`}
                    value={form.body}
                    onFocus={() => (lastField.current = "body")}
                    onChange={(e) => setForm({ ...form, body: e.target.value })}
                  />
                  <p className="mt-1.5 text-xs text-zinc-500">HTML body. Placeholders match CSV column names (case-insensitive).</p>
                </div>
              </div>

              <div className="min-w-0 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Icon name="eye" className="h-4 w-4 text-zinc-400" /> Live preview
                </div>
                {vars.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {vars.map((v) => (
                      <div key={v} className="relative">
                        <span className="absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-[11px] text-zinc-400">{v}</span>
                        <input
                          className={inputCls}
                          style={{ paddingLeft: `${v.length * 7 + 20}px` }}
                          value={sample[v] ?? ""}
                          placeholder="sample value"
                          onChange={(e) => setSample({ ...sample, [v]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                )}
                <EmailPreview subject={render(form.subject, sampleData)} html={render(form.body, sampleData, true)} to={sampleData.email} />
              </div>
            </div>
          </Card>

        </div>
      </div>
    </>
  );
}
