import { cookies } from "next/headers";
import { ArrowLeftRight, LogOut } from "lucide-react";

import { logoutAction } from "@/app/login/actions";
import { AUTH_COOKIE } from "@/lib/auth";
import { currentAnalyst } from "@/lib/session";
import { currentDemoPersona } from "@/lib/demo-session";
import { DEMO_PERSONAS } from "@/lib/demo-personas";
import { currentSession } from "@/lib/identity/current";

/** Keep account and exit controls visible directly below the workspace logo. */
export async function SignOut() {
  const session = await currentSession();
  if (session) return <VerifiedAccount session={session} />;
  const jar = await cookies();
  if (!jar.get(AUTH_COOKIE)) return null;
  const analyst = await currentAnalyst();
  const persona = await currentDemoPersona();

  return (
    <section
      aria-label="Current demo account"
      className="bg-card rounded-lg border p-3"
    >
      <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
        Signed in as
      </p>
      <p className="truncate text-sm font-semibold">
        {persona ? DEMO_PERSONAS[persona].label : "Unverified"}
      </p>
      <p className="text-muted-foreground truncate text-xs">
        {analyst.displayName} · self-declared
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <form action={logoutAction}>
          <button
            type="submit"
            name="intent"
            value="switch"
            className="border-border hover:bg-accent focus-visible:ring-ring flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <ArrowLeftRight size={14} aria-hidden="true" />
            Switch role
          </button>
        </form>
        <form action={logoutAction}>
          <button
            type="submit"
            className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <LogOut size={14} aria-hidden="true" />
            Sign out
          </button>
        </form>
      </div>
    </section>
  );
}

async function VerifiedAccount({
  session,
}: {
  session: NonNullable<Awaited<ReturnType<typeof currentSession>>>;
}) {
  const roles = session.identity.roles
    .map((role) => role.replace("_", " ").toLowerCase())
    .join(", ");
  return (
    <section
      aria-label="Current account"
      className="bg-card rounded-lg border p-3"
    >
      <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
        Signed in as
      </p>
      <p className="truncate text-sm font-semibold">{session.displayName}</p>
      <p className="text-muted-foreground truncate text-xs">{session.email}</p>
      <p className="text-muted-foreground mt-1 truncate text-xs capitalize">
        {roles || "No role assigned"} · verified
      </p>
      <form action={logoutAction} className="mt-3">
        <button
          type="submit"
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <LogOut size={14} aria-hidden="true" />
          Sign out
        </button>
      </form>
    </section>
  );
}
