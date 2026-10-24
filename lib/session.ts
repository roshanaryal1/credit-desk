import "server-only";

import { cookies } from "next/headers";

import {
  AUTH_COOKIE,
  DEV_SESSION_COOKIE,
  gateConfig,
  verifySession,
} from "@/lib/auth";
import type { Analyst } from "@/lib/trust/decide";

// The current analyst, from the signed session cookie. Attribution is
// self-declared at sign-in, not authenticated (SPEC 11, X21).

export const MODE_COOKIE = "cd_mode";

export async function currentAnalyst(): Promise<Analyst> {
  const jar = await cookies();
  const mode = jar.get(MODE_COOKIE)?.value === "ASSIST" ? "ASSIST" : "SHADOW";
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
