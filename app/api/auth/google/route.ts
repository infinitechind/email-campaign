import { appUrl, googleConfig, startGoogleLogin } from "@/lib/auth";

/** Start "Sign in with Google" (also registers new users on first login). */
export async function GET(req: Request) {
  const cfg = googleConfig();
  if (!cfg) return Response.redirect(`${appUrl(req)}/login?error=not_configured`, 302);
  return Response.redirect(await startGoogleLogin(req, cfg.clientId), 302);
}
