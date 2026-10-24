import "server-only";

import { cookies } from "next/headers";

import { AUTH_COOKIE, gateConfig, verifySession } from "@/lib/auth";
import {
  demoCanWrite,
  parseDemoPersona,
  type DemoPersona,
} from "@/lib/demo-personas";

/** Demo perspectives are self-selected; they never grant real tenant rights. */
export async function currentDemoPersona(): Promise<DemoPersona | null> {
  const gate = gateConfig();
  if (!gate.enforce) return "ANALYST";
  if (!gate.configured) return null;
  const session = await verifySession(
    (await cookies()).get(AUTH_COOKIE)?.value,
    gate.secret,
  );
  return session ? (parseDemoPersona(session.persona) ?? "ANALYST") : null;
}

/** Every write action checks signed session provenance, not only role labels. */
export async function canPerformDemoWrite(): Promise<boolean> {
  const gate = gateConfig();
  if (!gate.enforce) return true; // Local development without a password gate.
  if (!gate.configured) return false;
  const session = await verifySession(
    (await cookies()).get(AUTH_COOKIE)?.value,
    gate.secret,
  );
  if (!session) return false;
  const persona = parseDemoPersona(session.persona) ?? "ANALYST";
  return demoCanWrite(persona, session.publicDemo === true);
}
