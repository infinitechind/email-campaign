"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api, Badge, Button, Card, Field, Icon, inputCls, json, PageHeader, useUi, type IconName } from "./common";

type Smtp = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from_name: string;
  from_email: string;
  delay_ms: number;
};

const EMPTY: Smtp = { host: "", port: 587, secure: false, username: "", password: "", from_name: "", from_email: "", delay_ms: 1000 };

const PRESETS: { name: string; host: string; port: number; secure: boolean; note?: string }[] = [
  { name: "Gmail", host: "smtp.gmail.com", port: 587, secure: false, note: "Use an App Password" },
  { name: "Outlook", host: "smtp.office365.com", port: 587, secure: false },
  { name: "SendGrid", host: "smtp.sendgrid.net", port: 587, secure: false, note: 'Username is "apikey"' },
  { name: "Mailgun", host: "smtp.mailgun.org", port: 587, secure: false },
  { name: "Amazon SES", host: "email-smtp.us-east-1.amazonaws.com", port: 587, secure: false },
  { name: "Zoho", host: "smtp.zoho.com", port: 465, secure: true },
];

export default function SmtpPanel({ onSaved }: { onSaved: () => void }) {
  const { toast } = useUi();
  const [form, setForm] = useState<Smtp>(EMPTY);
  const [hasPassword, setHasPassword] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api<(Omit<Smtp, "secure"> & { secure: number; has_password: boolean }) | null>("/api/smtp").then((cfg) => {
      if (!cfg) return;
      setForm({ ...EMPTY, ...cfg, secure: !!cfg.secure, password: "" });
      setHasPassword(cfg.has_password);
      setSaved(true);
    });
  }, []);

  const set = <K extends keyof Smtp>(k: K, v: Smtp[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    try {
      await api("/api/smtp", json("PUT", form));
      if (form.password) setHasPassword(true);
      setForm((f) => ({ ...f, password: "" }));
      setSaved(true);
      setDirty(false);
      onSaved();
      toast("ok", "SMTP settings saved");
    } catch (err) {
      toast("err", "Could not save", (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setTestResult(null);
    try {
      await api("/api/smtp/test", json("POST", { to: testTo || undefined }));
      setTestResult({ ok: true, text: testTo ? `Connected and sent a test email to ${testTo}.` : "Connected — the server accepted the login." });
    } catch (err) {
      setTestResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const perMinute = form.delay_ms > 0 ? Math.round(60000 / form.delay_ms) : null;

  return (
    <>
      <PageHeader
        title="SMTP Settings"
        description="Connect the mail server that will deliver your campaigns."
        actions={saved ? <Badge tone={dirty ? "amber" : "green"} dot>{dirty ? "Unsaved changes" : "Configured"}</Badge> : <Badge tone="amber" dot>Not configured</Badge>}
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <form onSubmit={save} className="space-y-6">
          <Card title="Quick setup" description="Pick a provider to pre-fill host and port.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PRESETS.map((p) => {
                const active = form.host === p.host;
                return (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => {
                      setForm((f) => ({ ...f, host: p.host, port: p.port, secure: p.secure }));
                      setDirty(true);
                    }}
                    className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                      active
                        ? "border-indigo-500 bg-indigo-50 ring-4 ring-indigo-500/10 dark:bg-indigo-500/10"
                        : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                    }`}
                  >
                    <span className="block font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-zinc-500">{p.note ?? `${p.host}:${p.port}`}</span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card>
            <div className="space-y-8">
              <Section icon="server" title="Server">
                <div className="grid gap-4 sm:grid-cols-[1fr_120px_170px]">
                  <Field label="Host">
                    <input className={inputCls} required value={form.host} onChange={(e) => set("host", e.target.value)} placeholder="smtp.example.com" />
                  </Field>
                  <Field label="Port">
                    <input
                      className={inputCls}
                      type="number"
                      required
                      value={form.port}
                      onChange={(e) => {
                        const port = Number(e.target.value);
                        setForm((f) => ({ ...f, port, secure: port === 465 ? true : port === 587 ? false : f.secure }));
                        setDirty(true);
                      }}
                    />
                  </Field>
                  <Field label="Encryption">
                    <Segmented
                      value={form.secure ? "ssl" : "tls"}
                      onChange={(v) => set("secure", v === "ssl")}
                      options={[
                        { value: "tls", label: "STARTTLS" },
                        { value: "ssl", label: "SSL/TLS" },
                      ]}
                    />
                  </Field>
                </div>
              </Section>

              <Section icon="lock" title="Authentication">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Username">
                    <input className={inputCls} autoComplete="off" value={form.username} onChange={(e) => set("username", e.target.value)} />
                  </Field>
                  <Field label="Password" hint={hasPassword ? "A password is saved — leave blank to keep it." : undefined}>
                    <input
                      className={inputCls}
                      type="password"
                      autoComplete="new-password"
                      value={form.password}
                      placeholder={hasPassword ? "••••••••••" : ""}
                      onChange={(e) => set("password", e.target.value)}
                    />
                  </Field>
                </div>
              </Section>

              <Section icon="user" title="Sender">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="From name">
                    <input className={inputCls} value={form.from_name} onChange={(e) => set("from_name", e.target.value)} placeholder="Acme Inc." />
                  </Field>
                  <Field label="From email">
                    <input className={inputCls} type="email" required value={form.from_email} onChange={(e) => set("from_email", e.target.value)} placeholder="hello@acme.com" />
                  </Field>
                </div>
              </Section>

              <Section icon="clock" title="Sending speed">
                <Field
                  label="Delay between emails"
                  hint={perMinute ? `≈ ${perMinute.toLocaleString()} emails per minute. Emails are sent one at a time.` : "No delay — sends as fast as the server allows."}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={10000}
                      step={100}
                      value={form.delay_ms}
                      onChange={(e) => set("delay_ms", Number(e.target.value))}
                      className="flex-1 accent-indigo-600"
                    />
                    <div className="relative w-32">
                      <input className={`${inputCls} pr-9`} type="number" min={0} value={form.delay_ms} onChange={(e) => set("delay_ms", Number(e.target.value))} />
                      <span className="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-zinc-400">ms</span>
                    </div>
                  </div>
                </Field>
              </Section>
            </div>

            <div className="mt-8 flex justify-end border-t border-zinc-100 pt-5 dark:border-zinc-800">
              <Button type="submit" loading={busy === "save"} icon="check">
                Save settings
              </Button>
            </div>
          </Card>
        </form>

        <div className="space-y-6">
          <Card title="Test connection" description="Check the saved settings before sending a campaign.">
            <div className="space-y-3">
              <Field label="Send test to (optional)">
                <input className={inputCls} type="email" placeholder="you@example.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
              </Field>
              <Button variant="secondary" className="w-full" icon="bolt" loading={busy === "test"} disabled={!saved || dirty} onClick={test}>
                Test SMTP
              </Button>
              {(!saved || dirty) && <p className="text-xs text-zinc-500">Save your settings first.</p>}
              {testResult && (
                <div
                  className={`animate-fade-in rounded-xl p-3 text-sm ${
                    testResult.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                  }`}
                >
                  <p className="flex items-center gap-1.5 font-medium">
                    <Icon name={testResult.ok ? "check" : "alert"} />
                    {testResult.ok ? "Success" : "Connection failed"}
                  </p>
                  <p className="mt-1 break-words opacity-90">{testResult.text}</p>
                </div>
              )}
            </div>
          </Card>

          <Card title="Tips">
            <ul className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
              <li>• Port <b>587</b> uses STARTTLS, port <b>465</b> uses SSL/TLS.</li>
              <li>• Gmail and Outlook need an app password when 2FA is on.</li>
              <li>• Add a delay to stay under your provider&apos;s rate limits.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function Section({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <Icon name={icon} className="h-3.5 w-3.5" />
        </span>
        {title}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition ${
            value === o.value ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white" : "text-zinc-500 hover:text-zinc-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
