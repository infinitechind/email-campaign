"use client";

import { useSearchParams } from "next/navigation";

const MESSAGES: Record<string, string> = {
  cancelled: "Sign-in was cancelled. Try again when you're ready.",
  expired: "Your sign-in attempt expired. Please try again.",
  state_mismatch: "We couldn't verify that sign-in attempt. Please try again.",
  unverified_email: "Your Google account's email address isn't verified.",
  google_error: "Google sign-in failed. Please try again.",
  not_configured:
    "Google sign-in isn't configured on the server yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local and restart.",
};

export default function LoginError() {
  const code = useSearchParams().get("error");
  if (!code) return null;
  return (
    <div className="mb-4 rounded-xl bg-rose-50 px-3.5 py-3 text-sm text-rose-800 ring-1 ring-rose-200 ring-inset dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-900">
      {MESSAGES[code] ?? MESSAGES.google_error}
    </div>
  );
}
