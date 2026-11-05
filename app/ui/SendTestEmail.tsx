"use client";

import { useState } from "react";
import { api, Button, Callout, Field, inputCls, json, Modal, useUi } from "./common";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STORAGE_KEY = "bulkemail:test-recipient";

function loadLastRecipient(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * "Send test" button + modal. Sends the given (possibly unsaved) template, rendered with `data`,
 * straight through the saved SMTP settings — it does not go through the campaign queue.
 */
export default function SendTestEmail({
  subject,
  body,
  data,
  dataLabel,
  replyTo,
  disabled,
  variant = "secondary",
}: {
  subject: string;
  body: string;
  data: Record<string, string>;
  /** Describes where the placeholder values come from, e.g. "sample values" or "CSV row 3". */
  dataLabel: string;
  replyTo?: string;
  disabled?: boolean;
  variant?: "secondary" | "ghost";
}) {
  const { toast } = useUi();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [prefix, setPrefix] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addresses = to.split(",").map((s) => s.trim()).filter(Boolean);
  const valid = addresses.length > 0 && addresses.length <= 5 && addresses.every((a) => EMAIL_RE.test(a));
  const filled = Object.entries(data).filter(([, v]) => v);

  function show() {
    setTo((t) => t || loadLastRecipient());
    setError(null);
    setOpen(true);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/test-email", json("POST", { to, subject, body, data, replyTo, prefix }));
      try {
        localStorage.setItem(STORAGE_KEY, to);
      } catch {
        /* storage unavailable — not important */
      }
      toast("ok", "Test email sent", addresses.join(", "));
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant={variant} icon="mail" onClick={show} disabled={disabled || !subject || !body}>
        Send test
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Send a test email"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="send-test-form" icon="send" loading={busy} disabled={!valid}>
              Send test
            </Button>
          </>
        }
      >
        <form id="send-test-form" onSubmit={send} className="space-y-4">
          <Field label="Send to" hint="Up to 5 addresses, separated by commas. Sent immediately — not added to any campaign.">
            <input
              autoFocus
              className={inputCls}
              type="text"
              inputMode="email"
              placeholder="you@example.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={prefix} onChange={(e) => setPrefix(e.target.checked)} />
            Add <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800">[TEST]</code> to the subject
          </label>

          <div className="rounded-xl bg-zinc-50 p-3 text-xs dark:bg-zinc-900">
            <p className="mb-1.5 font-medium text-zinc-600 dark:text-zinc-300">Placeholders filled from {dataLabel}</p>
            {filled.length ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                {filled.slice(0, 8).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="font-mono text-zinc-500">{k}</dt>
                    <dd className="truncate">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-zinc-500">No values — placeholders will be sent as-is.</p>
            )}
            {replyTo && <p className="mt-2 text-zinc-500">Reply-To: {replyTo}</p>}
          </div>

          {error && <Callout tone="red">{error}</Callout>}
        </form>
      </Modal>
    </>
  );
}
