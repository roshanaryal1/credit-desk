import { cookies } from "next/headers";

import { logoutAction } from "@/app/login/actions";
import { AUTH_COOKIE } from "@/lib/auth";
import { currentAnalyst } from "@/lib/session";
import { currentDemoPersona } from "@/lib/demo-session";
import { DEMO_PERSONAS } from "@/lib/demo-personas";

export async function SignOut() {
  const jar = await cookies();
  if (!jar.get(AUTH_COOKIE)) return null;
  const analyst = await currentAnalyst();
  const persona = await currentDemoPersona();
  return (
    <form
      action={logoutAction}
      className="text-muted-foreground px-3 py-2 text-sm"
    >
      <p className="truncate">Demo: {persona ? DEMO_PERSONAS[persona].label : "Unverified"}</p>
      <p className="truncate text-xs">{analyst.displayName} · self-declared</p>
      <button className="text-primary underline underline-offset-4">
        Switch view / Sign out
      </button>
    </form>
  );
}
