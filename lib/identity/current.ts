import "server-only";

import { cookies } from "next/headers";
import { connection } from "next/server";

import { getDb } from "@/lib/db/client";
import { authorize } from "@/lib/security/access";

import { authMode, oidcConfig } from "./config";
import { resolveSession, type ResolvedSession } from "./store";
import { SESSION_COOKIE } from "./tokens";

/** The verified session for this request in OIDC mode, otherwise null. */
export async function currentSession(): Promise<ResolvedSession | null> {
  await connection();
  if (authMode() !== "oidc") return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const oidc = oidcConfig();
  return resolveSession(await getDb(), token, new Date(), {
    tenantId: oidc.tenantId,
    issuer: oidc.issuer.href,
  });
}

/**
 * Whether this request may record analyst work for a client. Demo mode has
 * no client grants; OIDC mode requires the ANALYST role and a grant.
 */
export async function analystMayWriteForClient(
  clientId: string,
): Promise<boolean> {
  if (authMode() !== "oidc") return true;
  const session = await currentSession();
  return (
    !!session &&
    session.identity.roles.includes("ANALYST") &&
    session.identity.clientGrants.includes(clientId)
  );
}

/** The current session when it may administer users (ADMIN with MFA). */
export async function currentAdministrator(): Promise<ResolvedSession | null> {
  const session = await currentSession();
  if (!session) return null;
  return authorize(
    session.identity,
    { tenantId: session.identity.tenantId },
    "USER_ADMIN",
    Date.now(),
  ).allowed
    ? session
    : null;
}
