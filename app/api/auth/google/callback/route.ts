import { appUrl, createSession, finishGoogleLogin, googleConfig, LoginError, upsertGoogleUser } from "@/lib/auth";

export async function GET(req: Request) {
  const base = appUrl(req);
  const cfg = googleConfig();
  if (!cfg) return Response.redirect(`${base}/login?error=not_configured`, 302);
  try {
    const claims = await finishGoogleLogin(req, cfg);
    await createSession(await upsertGoogleUser(claims));
    return Response.redirect(`${base}/`, 302);
  } catch (err) {
    const code = err instanceof LoginError ? err.message : "google_error";
    if (!(err instanceof LoginError)) console.error("[auth] callback failed", err);
    return Response.redirect(`${base}/login?error=${code}`, 302);
  }
}
