/** Self-selected demo perspectives, NOT verified identities or enterprise RBAC. */
export const DEMO_PERSONAS = {
  EMPLOYER: {
    label: "Employer / lender",
    description: "Explore the full synthetic lending workbench and portfolio.",
    home: "/",
  },
  ANALYST: {
    label: "Credit analyst",
    description: "Review flagged invoices and record sandbox decisions.",
    home: "/queue",
  },
  CHECKER: {
    label: "Credit checker",
    description: "Inspect cases and memo evidence without sign-off authority.",
    home: "/queue",
  },
  CLIENT: {
    label: "Client / borrower",
    description: "See a fictional borrower's limited relationship snapshot.",
    home: "/demo/client",
  },
  AUDITOR: {
    label: "Auditor",
    description: "Review synthetic decision history and integrity evidence.",
    home: "/audit",
  },
} as const;

export type DemoPersona = keyof typeof DEMO_PERSONAS;
export const DEMO_PERSONA_KEYS = Object.keys(DEMO_PERSONAS) as DemoPersona[];
export const DEMO_CLIENT_ID = "cli_0001";

export function parseDemoPersona(value: unknown): DemoPersona | null {
  return typeof value === "string" && Object.hasOwn(DEMO_PERSONAS, value)
    ? (value as DemoPersona)
    : null;
}

/**
 * A navigation/data-minimisation guard for PUBLICLY SELF-SELECTED synthetic
 * personas, not an authorization mechanism suitable for sensitive records.
 * Always match complete path segments. Server actions use a separate guard.
 */
export function demoRouteAllowed(persona: DemoPersona, path: string): boolean {
  if (path === "/about") return true;
  if (persona === "CLIENT") return path === "/demo/client";
  if (path === "/demo/client") return false;
  const allowed = {
    EMPLOYER: [
      "/queue",
      "/batches",
      "/watch",
      "/clients",
      "/borrowing-base",
      "/credit-memos",
      "/trust",
      "/audit",
    ],
    ANALYST: [
      "/queue",
      "/batches",
      "/watch",
      "/clients",
      "/borrowing-base",
      "/credit-memos",
      "/trust",
      "/audit",
    ],
    CHECKER: [
      "/queue",
      "/batches",
      "/watch",
      "/clients",
      "/borrowing-base",
      "/credit-memos",
      "/trust",
    ],
    AUDITOR: ["/trust", "/audit", "/clients", "/credit-memos", "/watch"],
  } as const;
  return (
    path === "/" ||
    allowed[persona].some(
      (prefix) => path === prefix || path.startsWith(prefix + "/"),
    )
  );
}

export function demoCanWrite(persona: DemoPersona, publicDemo = false): boolean {
  return persona === "ANALYST" && !publicDemo;
}
