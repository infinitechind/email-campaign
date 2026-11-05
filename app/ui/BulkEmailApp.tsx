"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import SmtpPanel from "./SmtpPanel";
import TemplatesPanel from "./TemplatesPanel";
import SendPanel from "./SendPanel";
import CampaignsPanel from "./CampaignsPanel";
import { api, Icon, signOut, UiProvider, type IconName } from "./common";

type Me = { id: string; email: string; name: string; picture: string | null };

const TABS: { key: Tab; label: string; icon: IconName; hint: string }[] = [
  { key: "smtp", label: "SMTP Settings", icon: "server", hint: "Mail server" },
  { key: "templates", label: "Templates", icon: "template", hint: "Write & preview" },
  { key: "send", label: "New Campaign", icon: "send", hint: "Upload CSV & send" },
  { key: "campaigns", label: "Campaigns", icon: "queue", hint: "Queue & retries" },
];
type Tab = "smtp" | "templates" | "send" | "campaigns";

const isTab = (v: string): v is Tab => TABS.some((t) => t.key === v);
const readHash = (): Tab => {
  const h = window.location.hash.slice(1);
  return isTab(h) ? h : "send";
};
const subscribeHash = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

type Status = { smtp: boolean; queued: number; failed: number };

export default function BulkEmailApp() {
  return (
    <UiProvider>
      <Shell />
    </UiProvider>
  );
}

function Shell() {
  const tab = useSyncExternalStore(subscribeHash, readHash, () => "send" as Tab);
  const [focusCampaign, setFocusCampaign] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ smtp: true, queued: 0, failed: 0 });
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api<Me>("/api/auth/me").then(setMe, () => {});
  }, []);

  const loadStatus = useCallback(async () => {
    const [smtp, campaigns] = await Promise.all([
      api<object | null>("/api/smtp").catch(() => null),
      api<{ pending: number | null; failed: number | null }[]>("/api/campaigns").catch(() => []),
    ]);
    setStatus({
      smtp: !!smtp,
      queued: campaigns.reduce((n, c) => n + (c.pending ?? 0), 0),
      failed: campaigns.reduce((n, c) => n + (c.failed ?? 0), 0),
    });
  }, []);

  useEffect(() => {
    const first = setTimeout(loadStatus, 0);
    const t = setInterval(loadStatus, 4000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [loadStatus, tab]);

  const go = (t: Tab) => {
    window.history.pushState(null, "", `#${t}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="flex min-h-screen w-full flex-col lg:flex-row">
      {/* Sidebar (desktop) / top bar (mobile) */}
      <aside className="sticky top-0 z-30 border-b border-zinc-200 bg-white/80 backdrop-blur-xl lg:h-screen lg:w-64 lg:shrink-0 lg:border-r lg:border-b-0 dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex items-center gap-2.5 px-4 py-3 lg:px-5 lg:py-5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30">
            <Icon name="mail" className="h-5 w-5" />
          </div>
          <div className="flex-1 leading-tight">
            <p className="font-semibold">Bulk Mailer</p>
            <p className="text-xs text-zinc-500">SMTP campaign sender</p>
          </div>
          {me && (
            <button onClick={() => void signOut()} className="flex items-center gap-2 rounded-full p-0.5 lg:hidden" title={`Sign out ${me.email}`}>
              <Avatar me={me} />
              <Icon name="logout" className="h-4 w-4 text-zinc-400" />
            </button>
          )}
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:px-3 lg:pb-0">
          {TABS.map((t) => {
            const active = tab === t.key;
            const badge =
              t.key === "smtp" && !status.smtp ? (
                <span className="h-2 w-2 rounded-full bg-amber-500" title="Not configured" />
              ) : t.key === "campaigns" && status.queued > 0 ? (
                <span className="rounded-full bg-indigo-600 px-1.5 text-[10px] font-semibold text-white">{status.queued}</span>
              ) : t.key === "campaigns" && status.failed > 0 ? (
                <span className="rounded-full bg-rose-600 px-1.5 text-[10px] font-semibold text-white">{status.failed}</span>
              ) : null;
            return (
              <button
                key={t.key}
                onClick={() => go(t.key)}
                className={`group flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition lg:py-2.5 ${
                  active
                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                }`}
              >
                <Icon name={t.icon} className={`h-[18px] w-[18px] ${active ? "" : "text-zinc-400 group-hover:text-zinc-600"}`} />
                <span className="flex-1">
                  <span className="block font-medium">{t.label}</span>
                  <span className="hidden text-xs text-zinc-400 lg:block">{t.hint}</span>
                </span>
                {badge}
              </button>
            );
          })}
        </nav>

        <div className="absolute inset-x-3 bottom-4 hidden space-y-2 lg:block">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-2 font-medium">
              <span className={`relative flex h-2 w-2`}>
                {status.queued > 0 && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${status.queued > 0 ? "bg-indigo-500" : status.smtp ? "bg-emerald-500" : "bg-amber-500"}`} />
              </span>
              {status.queued > 0 ? "Sending…" : status.smtp ? "Queue idle" : "SMTP not configured"}
            </div>
            <p className="mt-1 text-zinc-500">
              {status.queued} queued · {status.failed} failed
            </p>
          </div>
          {me && (
            <div className="flex items-center gap-2.5 rounded-xl p-2">
              <Avatar me={me} />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-medium">{me.name || me.email.split("@")[0]}</p>
                <p className="truncate text-xs text-zinc-500">{me.email}</p>
              </div>
              <button
                onClick={() => void signOut()}
                className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                title="Sign out"
                aria-label="Sign out"
              >
                <Icon name="logout" className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <div key={tab} className="animate-fade-in mx-auto max-w-6xl">
          {tab === "smtp" && <SmtpPanel onSaved={loadStatus} />}
          {tab === "templates" && <TemplatesPanel />}
          {tab === "send" && (
            <SendPanel
              smtpReady={status.smtp}
              onGo={go}
              onQueued={(id) => {
                setFocusCampaign(id);
                go("campaigns");
              }}
            />
          )}
          {tab === "campaigns" && <CampaignsPanel initialId={focusCampaign} onNew={() => go("send")} />}
        </div>
      </main>
    </div>
  );
}

function Avatar({ me }: { me: Me }) {
  const initials = (me.name || me.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return me.picture ? (
    // Google profile photos are external URLs; a plain <img> avoids next/image remotePatterns config.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={me.picture} alt="" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-full object-cover ring-2 ring-white dark:ring-zinc-900" />
  ) : (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
      {initials}
    </span>
  );
}
