import { NextResponse, type NextRequest } from "next/server";

import {
  AUTH_COOKIE,
  DEV_SESSION_COOKIE,
  gateConfig,
  verifySession,
} from "@/lib/auth";
import {
  DEMO_PERSONAS,
  demoRouteAllowed,
  parseDemoPersona,
} from "@/lib/demo-personas";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { authMode, oidcConfig } from "@/lib/identity/config";
import {
  batchIdFromPath,
  clientIdFromPath,
  identityRouteAllowed,
  isPortfolioWidePath,
  RECORD_ID,
} from "@/lib/identity/policy";
import { resolveSession } from "@/lib/identity/store";
import { SESSION_COOKIE } from "@/lib/identity/tokens";
import { eq } from "drizzle-orm";

// Shared-password gate (SPEC 11). Every route except the login page, the cron
// route and static assets needs a valid signed session cookie.

const OPEN_PATHS = ["/login", "/api/watch/run"];
// OIDC mode also leaves the sign-in redirect and callback open.
const OIDC_OPEN_PATHS = [...OPEN_PATHS, "/auth/login", "/auth/callback"];

/**
 * Fetch-based server actions (Next-Action header) cannot follow an HTTP
 * redirect to an HTML page: the client throws "An unexpected response was
 * received from the server" (#199). Next.js clients instead navigate on an
 * x-action-redirect header with an empty body. The action never runs.
 */
function redirectTo(request: NextRequest, destination: URL) {
  if (request.headers.has("next-action")) {
    return new NextResponse(null, {
      status: 200,
      headers: {
        "content-type": "text/plain",
        "x-action-redirect": `${destination.pathname}${destination.search};push`,
      },
    });
  }
  return NextResponse.redirect(destination);
}

export async function proxy(request: NextRequest) {
  if (authMode() === "oidc") return identityProxy(request);
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
      return redirectTo(request, destination);
    }
    return NextResponse.next();
  }

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = `?next=${encodeURIComponent(pathname + search)}`;
  return redirectTo(request, login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "malformed%";
  }
}

/**
 * Deny without revealing whether the record exists. Server actions get the
 * action-aware redirect so the client navigates instead of erroring (#199).
 */
function deny(request: NextRequest) {
  if (request.headers.has("next-action")) {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return redirectTo(request, home);
  }
  return new NextResponse("Not found", { status: 404 });
}

/** The client a scoped path belongs to, or undefined for unscoped paths. */
async function pathClient(
  pathname: string,
): Promise<string | null | undefined> {
  const direct = clientIdFromPath(pathname);
  if (direct) return direct;
  const batchId = batchIdFromPath(pathname);
  const decisionRaw = /^\/trust\/replay\/([^/]+)/.exec(pathname)?.[1];
  // Anything that is not a well-formed record id (including NUL or invalid
  // escapes) is denied before it can reach a query.
  for (const id of [batchId, decisionRaw && safeDecode(decisionRaw)])
    if (id && !RECORD_ID.test(id)) return null;
  const db =
    batchId || pathname.startsWith("/trust/replay/") ? await getDb() : null;
  if (batchId && db) {
    const [batch] = await db
      .select({ clientId: t.batches.clientId })
      .from(t.batches)
      .where(eq(t.batches.id, batchId));
    return batch?.clientId ?? null;
  }
  const decisionId = /^\/trust\/replay\/([^/]+)/.exec(pathname)?.[1];
  if (decisionId && db) {
    const [row] = await db
      .select({ clientId: t.invoices.clientId })
      .from(t.decisions)
      .innerJoin(t.invoices, eq(t.decisions.invoiceId, t.invoices.id))
      .where(eq(t.decisions.id, safeDecode(decisionId)));
    return row?.clientId ?? null;
  }
  return undefined;
}

/**
 * Verified identity gate (#109): a revocable database session, role routes
 * and per-client grants on every client-scoped path. Pages and actions still
 * apply their own checks; this is the outer boundary.
 */
async function identityProxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (
    OIDC_OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  )
    return NextResponse.next();
  const oidc = oidcConfig();
  const session = await resolveSession(
    await getDb(),
    request.cookies.get(SESSION_COOKIE)?.value,
    new Date(),
    { tenantId: oidc.tenantId, issuer: oidc.issuer.href },
  );
  if (!session) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(pathname + search)}`;
    return redirectTo(request, login);
  }
  const { roles, clientGrants } = session.identity;
  if (!identityRouteAllowed(roles, pathname)) {
    const home = request.nextUrl.clone();
    home.pathname = identityRouteAllowed(roles, "/") ? "/" : "/admin/users";
    home.search = "";
    if (home.pathname === pathname) return deny(request);
    return redirectTo(request, home);
  }
  if (
    isPortfolioWidePath(pathname) &&
    !(await grantsEveryClient(clientGrants))
  ) {
    // Partial grants see their own clients, never portfolio aggregates.
    const first = [...clientGrants].sort()[0];
    if (!first) return deny(request);
    const own = request.nextUrl.clone();
    own.pathname = `/clients/${encodeURIComponent(first)}`;
    own.search = "";
    return redirectTo(request, own);
  }
  const clientId = await pathClient(pathname);
  // Unknown or ungranted clients look the same: not found.
  if (
    clientId !== undefined &&
    (clientId === null || !clientGrants.includes(clientId))
  )
    return deny(request);
  return NextResponse.next();
}

/** Whether grants cover every client, so portfolio aggregates disclose nothing extra. */
async function grantsEveryClient(grants: readonly string[]): Promise<boolean> {
  const clients = await (
    await getDb()
  )
    .select({ id: t.clients.id })
    .from(t.clients);
  return clients.length > 0 && clients.every((c) => grants.includes(c.id));
}
