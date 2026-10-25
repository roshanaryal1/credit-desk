import { Nav } from "@/components/nav";
import { currentDemoPersona } from "@/lib/demo-session";

export async function PersonaNav() {
  const persona = await currentDemoPersona();
  return <Nav persona={persona ?? "ANALYST"} />;
}
