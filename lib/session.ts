import "server-only";

import { cookies } from "next/headers";
import { connection } from "next/server";

import {
  AUTH_COOKIE,
  DEV_SESSION_COOKIE,
  gateConfig,
  verifySession,
} from "@/lib/auth";
import { authMode } from "@/lib/identity/config";
import { currentSession } from "@/lib/identity/current";
import type { Analyst } from "@/lib/trust/decide";

// The current analyst, from the signed session cookie. Attribution is
// self-declared at sign-in, not authenticated (SPEC 11, X21).

export const MODE_COOKIE = "cd_mode";

export async function currentAnalyst(): Promise<Analyst> {
  await connection();
  const jar = await cookies();
  const mode = jar.get(MODE_COOKIE)?.value === "ASSIST" ? "ASSIST" : "SHADOW";
  if (authMode() === "oidc") {
    // Attribution comes from the verified, provisioned user (#109).
    const session = await currentSession();
    return {
      sessionId: session?.sessionId ?? "unauthenticated",
      displayName: session?.displayName ?? "Unauthenticated",
      mode,
    };
  }
  const gate = gateConfig();
  const session = gate.configured
    ? await verifySession(jar.get(AUTH_COOKIE)?.value, gate.secret)
    : null;
  return {
    sessionId:
      session?.sid ?? jar.get(DEV_SESSION_COOKIE)?.value ?? "local-dev",
    displayName: session?.name || "Local analyst",
    mode,
  };
}

/**
 * The analyst for a write. In identity mode the actor is built from one
 * verified session lookup; a missing or revoked session yields null, so no
 * write is ever attributed to an unverified actor.
 */
export async function writingAnalyst(): Promise<Analyst | null> {
  if (authMode() !== "oidc") return currentAnalyst();
  const session = await currentSession();
  if (!session) return null;
  const jar = await cookies();
  return {
    sessionId: session.sessionId,
    displayName: session.displayName,
    mode: jar.get(MODE_COOKIE)?.value === "ASSIST" ? "ASSIST" : "SHADOW",
  };
}
