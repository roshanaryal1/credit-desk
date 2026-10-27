import { connection, NextResponse } from "next/server";

import { AUTH_COOKIE } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { authMode, oidcConfig } from "@/lib/identity/config";
import { completeSignIn } from "@/lib/identity/oidc";
import {
  bindUser,
  createSession,
  UserNotActiveError,
} from "@/lib/identity/store";
import {
  LOGIN_COOKIE,
  openLogin,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "@/lib/identity/tokens";
import { MODE_COOKIE } from "@/lib/session";

function toLogin(base: URL, error: string) {
  const response = NextResponse.redirect(
    new URL(`/login?error=${error}`, base),
  );
  response.cookies.delete({ name: LOGIN_COOKIE, path: "/auth" });
  return response;
}

/** Complete OIDC sign-in: verify, bind a provisioned user, require MFA. */
export async function GET(request: Request) {
  // Never prerender: the mode, cookies and IdP state are per request.
  await connection();
  if (authMode() !== "oidc")
    return Response.json({ error: "not_found" }, { status: 404 });
  const url = new URL(request.url);
  const oidc = oidcConfig();
  // The app's public origin is the registered redirect URI's; request.url may
  // carry an internal host behind a proxy, which would drop the session cookie.
  const appOrigin = new URL(oidc.redirectUri.origin);
  const sealed = request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${LOGIN_COOKIE}=`))
    ?.slice(LOGIN_COOKIE.length + 1);
  const transaction = openLogin(sealed, oidc.sessionSecret, Date.now());
  if (!transaction) return toLogin(appOrigin, "expired");

  // Rebuild the callback on the registered redirect URI so the token request
  // never trusts a proxy-rewritten host.
  const callbackUrl = new URL(oidc.redirectUri);
  callbackUrl.search = url.search;
  let claims;
  try {
    claims = await completeSignIn(oidc, callbackUrl, transaction);
  } catch (error) {
    console.log(
      JSON.stringify({
        event: "oidc_sign_in_failed",
        code: error instanceof Error ? error.name : "unknown",
      }),
    );
    return toLogin(appOrigin, "sign_in_failed");
  }
  if (!claims.mfa) return toLogin(appOrigin, "mfa_required");
  const db = await getDb();
  const bound = await bindUser(db, oidc.tenantId, claims);
  if (!bound.ok) return toLogin(appOrigin, bound.reason.toLowerCase());

  let session;
  try {
    session = await createSession(db, bound.userId, claims.mfa, new Date());
  } catch (error) {
    if (error instanceof UserNotActiveError)
      return toLogin(appOrigin, "disabled");
    throw error;
  }
  const response = NextResponse.redirect(new URL(transaction.next, appOrigin));
  response.cookies.delete({ name: LOGIN_COOKIE, path: "/auth" });
  response.cookies.delete(AUTH_COOKIE);
  response.cookies.delete(MODE_COOKIE);
  response.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return response;
}
