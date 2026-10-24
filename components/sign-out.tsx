import { cookies } from "next/headers";

import { logoutAction } from "@/app/login/actions";
import { AUTH_COOKIE } from "@/lib/auth";
import { currentAnalyst } from "@/lib/session";

export async function SignOut() {
  const jar = await cookies();
  if (!jar.get(AUTH_COOKIE)) return null;
  const analyst = await currentAnalyst();
  return (
    <form
      action={logoutAction}
      className="text-muted-foreground px-3 py-2 text-sm"
    >
      <p className="truncate">Signed in as {analyst.displayName}</p>
      <button className="text-primary underline underline-offset-4">
        Sign out
      </button>
    </form>
  );
}
