import "server-only";

import { cookies } from "next/headers";

import { AUTH_COOKIE, gateConfig, verifySession } from "@/lib/auth";
import { demoCanWrite, parseDemoPersona, type DemoPersona } from "@/lib/demo-personas";

/** Display-only demo roles must never be passed to enterprise authorization. */
export async function currentDemoPersona(): Promise<DemoPersona | null> {
  const gate = gateConfig();
  if (!gate.enforce) return "ANALYST";
  if (!gate.configured) return null;
  const jar = await cookies();
  const session = await verifySession(jar.get(AUTH_COOKIE)?.value, gate.secret);
  return session ? parseDemoPersona(session.persona) ?? "ANALYST" : null;
}

export async function canPerformDemoWrite(): Promise<boolean> {
  const persona = await currentDemoPersona();
  return persona !== null && demoCanWrite(persona);
}
