import crypto from "node:crypto";
import { cookies } from "next/headers";
import { claimLegacyDataIfFirst, cols, type ObjectId } from "./db";

/** The signed-in user as exposed to route handlers. */
export type User = { id: string; _id: ObjectId; email: string; name: string; picture: string | null };

export const SESSION_COOKIE = "be_session";
const SESSION_DAYS = 30;

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

const secureCookies = () => (process.env.APP_URL ?? "").startsWith("https://") || process.env.NODE_ENV === "production";

/* ------------------------------------------------------------------ Sessions */

/** Create a session for `userId` and set the cookie. */
export async function createSession(userId: ObjectId) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  // Expired sessions are removed by the TTL index on expiresAt.
  await (await cols()).sessions.insertOne({ _id: sha256(token), userId, expiresAt: expires, createdAt: new Date() });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    expires,
  });
}

/** The signed-in user for this request, or null. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const { sessions, users } = await cols();
  // TTL deletion is lazy (runs ~every 60s), so check expiry explicitly too.
  const session = await sessions.findOne({ _id: sha256(token), expiresAt: { $gt: new Date() } });
  if (!session) return null;
  const u = await users.findOne({ _id: session.userId });
  return u ? { id: u._id.toHexString(), _id: u._id, email: u.email, name: u.name, picture: u.picture } : null;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await (await cols()).sessions.deleteOne({ _id: sha256(token) });
  jar.delete(SESSION_COOKIE);
}

export const unauthorized = () => Response.json({ error: "Please sign in" }, { status: 401 });

/**
 * Route-handler guard. Usage:
 *   const user = await requireUser(); if (user instanceof Response) return user;
 */
export async function requireUser(): Promise<User | Response> {
  return (await currentUser()) ?? unauthorized();
}

/* ------------------------------------------------------------------ Google OAuth (OIDC, code flow + PKCE) */

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const OAUTH_COOKIE = "be_oauth";

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Public base URL. Set APP_URL in production (behind proxies the request origin can be wrong). */
export const appUrl = (req: Request) => (process.env.APP_URL ?? new URL(req.url).origin).replace(/\/$/, "");
export const redirectUri = (req: Request) => `${appUrl(req)}/api/auth/google/callback`;

/** Build the Google consent URL and stash state + PKCE verifier in a short-lived cookie. */
export async function startGoogleLogin(req: Request, clientId: string): Promise<string> {
  const state = randomToken(16);
  const verifier = randomToken(48);
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

  (await cookies()).set(OAUTH_COOKIE, JSON.stringify({ state, verifier }), {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax", // must survive the top-level redirect back from Google
    path: "/api/auth",
    maxAge: 600,
  });

  const url = new URL(GOOGLE_AUTH);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

type GoogleClaims = {
  iss: string;
  aud: string;
  sub: string;
  exp: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

/**
 * Validate the callback, exchange the code, and return the Google identity.
 * The ID token comes straight from Google's token endpoint over TLS, so per OIDC Core §3.1.3.7
 * we validate its claims (iss/aud/exp) without re-verifying the signature.
 */
export async function finishGoogleLogin(req: Request, cfg: { clientId: string; clientSecret: string }): Promise<GoogleClaims> {
  const params = new URL(req.url).searchParams;
  const jar = await cookies();
  const stash = jar.get(OAUTH_COOKIE)?.value;
  jar.delete({ name: OAUTH_COOKIE, path: "/api/auth" });

  if (params.get("error")) throw new LoginError(params.get("error") === "access_denied" ? "cancelled" : "google_error");
  let saved: { state: string; verifier: string };
  try {
    saved = JSON.parse(stash ?? "");
  } catch {
    throw new LoginError("expired");
  }
  const state = params.get("state") ?? "";
  if (!state || state.length !== saved.state.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(saved.state))) {
    throw new LoginError("state_mismatch");
  }
  const code = params.get("code");
  if (!code) throw new LoginError("google_error");

  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri(req),
      grant_type: "authorization_code",
      code_verifier: saved.verifier,
    }),
  });
  if (!res.ok) {
    console.error("[auth] token exchange failed", res.status, await res.text().catch(() => ""));
    throw new LoginError("google_error");
  }
  const { id_token } = (await res.json()) as { id_token?: string };
  const payload = id_token?.split(".")[1];
  if (!payload) throw new LoginError("google_error");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as GoogleClaims;

  const issOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!issOk || claims.aud !== cfg.clientId || claims.exp * 1000 < Date.now()) throw new LoginError("google_error");
  if (!claims.email || !claims.email_verified) throw new LoginError("unverified_email");
  return claims;
}

export class LoginError extends Error {}

/** Find or create (register) the user for a Google identity. The very first user inherits pre-login data. */
export async function upsertGoogleUser(c: GoogleClaims): Promise<ObjectId> {
  const { users } = await cols();
  const now = new Date();
  // Atomic find-or-create keyed on Google's stable subject id.
  const u = await users.findOneAndUpdate(
    { googleSub: c.sub },
    {
      $set: { email: c.email!, name: c.name ?? "", picture: c.picture ?? null, lastLoginAt: now },
      $setOnInsert: { googleSub: c.sub, createdAt: now },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (!u) throw new Error("user upsert failed");
  await claimLegacyDataIfFirst(u._id);
  return u._id;
}
