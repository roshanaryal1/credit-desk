import { Nav } from "@/components/nav";
import { currentDemoPersona } from "@/lib/demo-session";

export async function PersonaNav() {
  const persona = await currentDemoPersona();
  // Signed-out visitors (the login page) see only public links.
  return <Nav persona={persona} />;
}
