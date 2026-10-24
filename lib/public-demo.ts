import type { DemoPersona } from "./demo-personas";

/**
 * Public demo accounts are sign-in shortcuts, not real identities.
 * These reserved .example addresses are labels; they are not mailboxes.
 */
export const PUBLIC_DEMO_ACCOUNT_EMAILS: Record<DemoPersona, string> = {
  EMPLOYER: "employer@demo.creditdesk.example",
  ANALYST: "analyst@demo.creditdesk.example",
  CHECKER: "checker@demo.creditdesk.example",
  CLIENT: "client@demo.creditdesk.example",
  AUDITOR: "auditor@demo.creditdesk.example",
};

export const PUBLIC_DEMO_TTL_SECONDS = 60 * 60;

/**
 * Two explicit switches reduce accidental exposure. The operator must ALSO
 * verify the connected database holds ONLY fictional fixtures before enabling.
 * This is not automatic proof of data provenance or an access control for live
 * customer records.
 */
export function publicDemoEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.PUBLIC_DEMO_ENABLED === "1" &&
    env.CREDIT_DESK_DATA_CLASSIFICATION === "SYNTHETIC"
  );
}
