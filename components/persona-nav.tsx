import { Nav } from "@/components/nav";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { currentDemoPersona } from "@/lib/demo-session";
import { currentSession } from "@/lib/identity/current";
import { identityRouteAllowed } from "@/lib/identity/policy";

const NAV_ROUTES = [
  "/",
  "/queue",
  "/batches",
  "/watch",
  "/clients",
  "/borrowing-base",
  "/trust",
  "/credit-memos",
  "/audit",
  "/operations/sources",
  "/admin/users",
  "/about",
];

export async function PersonaNav() {
  const session = await currentSession();
  if (session) {
    const clients = await (
      await getDb()
    )
      .select({ id: t.clients.id, name: t.clients.name })
      .from(t.clients)
      .orderBy(t.clients.name);
    const grants = session.identity.clientGrants;
    const portfolio =
      clients.length > 0 && clients.every((c) => grants.includes(c.id));
    const roleRoutes = NAV_ROUTES.filter((href) =>
      identityRouteAllowed(session.identity.roles, href),
    );
    // Partial grants see their own clients; portfolio pages need every client.
    const allowed = portfolio
      ? roleRoutes
      : roleRoutes.filter(
          (href) => href === "/about" || href === "/admin/users",
        );
    const extra =
      portfolio || !identityRouteAllowed(session.identity.roles, "/clients")
        ? []
        : [
            {
              heading: "Your clients",
              items: clients
                .filter((c) => grants.includes(c.id))
                .map((c) => ({ href: `/clients/${c.id}`, label: c.name })),
            },
          ];
    return <Nav persona={null} allowed={allowed} extra={extra} />;
  }
  const persona = await currentDemoPersona();
  // Signed-out visitors (the login page) see only public links.
  return <Nav persona={persona} />;
}
