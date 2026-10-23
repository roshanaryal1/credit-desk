import { cookies } from "next/headers";

import type { Analyst } from "@/lib/trust/decide";

// Analyst session from cookies. proxy.ts guarantees cd_session exists.
// Attribution is self-declared, not authenticated (SPEC 11, X21).

export const SESSION_COOKIE = "cd_session";
export const MODE_COOKIE = "cd_mode";
export const NAME_COOKIE = "cd_name";

export async function currentAnalyst(): Promise<Analyst> {
  const jar = await cookies();
  const mode = jar.get(MODE_COOKIE)?.value === "ASSIST" ? "ASSIST" : "SHADOW";
  return {
    sessionId: jar.get(SESSION_COOKIE)?.value ?? "no-session",
    displayName: jar.get(NAME_COOKIE)?.value || "Analyst",
    mode,
  };
}
