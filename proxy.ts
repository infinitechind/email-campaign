import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "be_session"; // keep in sync with lib/auth.ts

/**
 * Optimistic auth gate: only checks that a session cookie exists (no DB access here).
 * Every API route still validates the session itself via requireUser().
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has(SESSION_COOKIE);

  if (pathname === "/login") {
    return hasSession ? NextResponse.redirect(new URL("/", req.url)) : NextResponse.next();
  }
  if (hasSession) return NextResponse.next();
  if (pathname.startsWith("/api/")) return Response.json({ error: "Please sign in" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  // Everything except auth endpoints, Next internals and static files.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
