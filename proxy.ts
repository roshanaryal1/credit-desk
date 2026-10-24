import { NextResponse, type NextRequest } from "next/server";

import {
  AUTH_COOKIE,
  DEV_SESSION_COOKIE,
  gateConfig,
  verifySession,
} from "@/lib/auth";
import { DEMO_PERSONAS, demoRouteAllowed, parseDemoPersona } from "@/lib/demo-personas";

// Shared-password gate (SPEC 11). Every route except the login page, the cron
// route and static assets needs a valid signed session cookie.

const OPEN_PATHS = ["/login", "/api/watch/run"];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)))
    return NextResponse.next();

  const gate = gateConfig();
  if (!gate.enforce) {
    // Gate off (development only): still give each browser its own session,
    // so exposure and attribution stay per analyst.
    const res = NextResponse.next();
    if (!request.cookies.get(DEV_SESSION_COOKIE)) {
      res.cookies.set(DEV_SESSION_COOKIE, crypto.randomUUID(), {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
    }
    return res;
  }
  if (!gate.configured) {
    return new NextResponse(
      "Credit Desk is not configured: set DEMO_PASSWORD and SESSION_SECRET.",
      { status: 503 },
    );
  }
  const session = await verifySession(
    request.cookies.get(AUTH_COOKIE)?.value,
    gate.secret,
  );
  if (session) {
    const persona = parseDemoPersona(session.persona) ?? "ANALYST";
    // Restrict synthetic demo perspectives at the server edge, not only in UI.
    if (!demoRouteAllowed(persona, pathname)) {
      const destination = request.nextUrl.clone();
      destination.pathname = DEMO_PERSONAS[persona].home;
      destination.search = "";
      return NextResponse.redirect(destination);
    }
    return NextResponse.next();
  }

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
