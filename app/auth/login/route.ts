import { connection, NextResponse } from "next/server";

import { getDb } from "@/lib/db/client";
import { authMode, oidcConfig } from "@/lib/identity/config";
import { beginSignIn } from "@/lib/identity/oidc";
import { LOGIN_COOKIE, LOGIN_TTL_MS, sealLogin } from "@/lib/identity/tokens";
import { takeAll } from "@/lib/rate-limit";
import { clientIp, safeNext } from "@/lib/request";

const WINDOW_MS = 15 * 60 * 1000;

/** Start OIDC sign-in (#109). Only available when AUTH_MODE=oidc. */
export async function GET(request: Request) {
  // Never prerender: the mode, cookies and IdP state are per request.
  await connection();
  if (authMode() !== "oidc")
    return Response.json({ error: "not_found" }, { status: 404 });
  const url = new URL(request.url);
  const allowed = await takeAll(await getDb(), [
    {
      key: `oidc-start:${clientIp(request.headers)}`,
      max: 30,
      windowMs: WINDOW_MS,
    },
    { key: "oidc-start:global", max: 2000, windowMs: WINDOW_MS },
  ]);
  const oidc = oidcConfig();
  if (!allowed)
    return NextResponse.redirect(
      new URL("/login?error=rate_limited", oidc.redirectUri.origin),
    );
  const { url: authorize, transaction } = await beginSignIn(
    oidc,
    safeNext(url.searchParams.get("next")),
    Date.now(),
  );
  const response = NextResponse.redirect(authorize);
  response.cookies.set(
    LOGIN_COOKIE,
    sealLogin(transaction, oidc.sessionSecret),
    {
      httpOnly: true,
      // Lax so the cookie returns on the IdP's top-level redirect to /auth/callback.
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/auth",
      maxAge: LOGIN_TTL_MS / 1000,
    },
  );
  return response;
}
