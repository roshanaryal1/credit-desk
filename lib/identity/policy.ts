import type { Role } from "@/lib/security/access";
import { demoRouteAllowed, type DemoPersona } from "@/lib/demo-personas";

export const ROLES: readonly Role[] = [
  "ANALYST",
  "CHECKER",
  "RISK_MANAGER",
  "AUDITOR",
  "ADMIN",
];

// Each verified role reuses the reviewed route scope of its matching
// workspace perspective; access is the union across a user's roles.
const ROLE_SCOPE: Record<Exclude<Role, "ADMIN">, DemoPersona> = {
  ANALYST: "ANALYST",
  CHECKER: "CHECKER",
  AUDITOR: "AUDITOR",
  RISK_MANAGER: "EMPLOYER",
};

/** Route policy for verified identities. The borrower demo is never served. */
export function identityRouteAllowed(
  roles: readonly Role[],
  path: string,
): boolean {
  if (path === "/about") return true;
  if (path === "/demo/client" || path.startsWith("/demo/")) return false;
  if (path === "/admin" || path.startsWith("/admin/"))
    return roles.includes("ADMIN");
  // Audit history follows the AUDIT_READ policy, not workspace navigation.
  if (path === "/audit" || path.startsWith("/audit/"))
    return roles.includes("AUDITOR") || roles.includes("RISK_MANAGER");
  return roles.some(
    (role) => role !== "ADMIN" && demoRouteAllowed(ROLE_SCOPE[role], path),
  );
}

/** Record ids are short slugs (for example cli_0001, bat_0008, dec_...). */
export const RECORD_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** A malformed escape never matches a real id or grant, so it fails closed. */
function decodeId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "malformed%";
  }
}

/** The client a path is scoped to, when the client id appears in the path. */
export function clientIdFromPath(path: string): string | null {
  const match =
    /^\/clients\/([^/]+)/.exec(path) ??
    /^\/credit-memos\/([^/]+)/.exec(path) ??
    /^\/borrowing-base\/clients\/([^/]+)/.exec(path);
  return match ? decodeId(match[1]!) : null;
}

/**
 * Pages and exports that aggregate every client. In identity mode they are
 * served only to users granted every client; per-grant filtering of these
 * read models is tracked separately. Client-scoped paths are not listed.
 */
export function isPortfolioWidePath(path: string): boolean {
  if (clientIdFromPath(path) || batchIdFromPath(path)) return false;
  if (path === "/about" || path.startsWith("/admin")) return false;
  if (/^\/trust\/replay\/[^/]+/.test(path)) return false;
  return true;
}

/** Batch id for batch-scoped paths, resolved to a client by the caller. */
export function batchIdFromPath(path: string): string | null {
  const match = /^\/batches\/([^/]+)/.exec(path);
  return match ? decodeId(match[1]!) : null;
}

export interface MfaPolicy {
  mfaMethods: string[];
  mfaAcr: string[];
}

// RFC 8176 method references grouped by factor type. A single method never
// proves multiple factors on its own.
const KNOWLEDGE = new Set(["pwd", "pin", "kba"]);
const POSSESSION_OR_INHERENCE = new Set([
  "otp",
  "hwk",
  "swk",
  "sms",
  "tel",
  "sc",
  "face",
  "fpt",
  "iris",
  "retina",
  "vbm",
]);

/**
 * True only when the ID token proves multiple factors: an explicit method in
 * the policy (default "mfa"), an approved acr, or a knowledge factor combined
 * with a possession or inherence factor.
 */
export function mfaSatisfied(
  claims: { amr?: unknown; acr?: unknown },
  policy: MfaPolicy,
): boolean {
  const amr = Array.isArray(claims.amr)
    ? claims.amr.filter((v): v is string => typeof v === "string")
    : [];
  if (amr.some((method) => policy.mfaMethods.includes(method))) return true;
  if (
    amr.some((m) => KNOWLEDGE.has(m)) &&
    amr.some((m) => POSSESSION_OR_INHERENCE.has(m))
  )
    return true;
  return typeof claims.acr === "string" && policy.mfaAcr.includes(claims.acr);
}
