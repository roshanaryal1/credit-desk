/**
 * Pure access policy. Only a trusted server-side OIDC token verifier may
 * construct IdentityContext. This function cannot validate token signatures.
 * Shared-password prototype sessions MUST NOT call this as "verified".
 */
export type Role = "ANALYST" | "CHECKER" | "RISK_MANAGER" | "ADMIN" | "AUDITOR";
export type Action =
  | "CLIENT_READ"
  | "CASE_READ"
  | "CASE_PROPOSE"
  | "CASE_CHECK"
  | "POLICY_EDIT"
  | "AUDIT_READ"
  | "CONNECTION_MANAGE"
  | "USER_ADMIN"
  | "FUNDING_EXECUTE";

export interface IdentityContext {
  subject: string;
  tenantId: string;
  clientGrants: string[];
  roles: Role[];
  mfaSatisfied: boolean;
  issuer: string;
  authenticatedUntilMs: number;
}

export interface AccessTarget {
  tenantId: string;
  clientId?: string;
}

export type AccessDecision =
  | { allowed: true; reason: "AUTHORIZED" }
  | {
      allowed: false;
      reason:
        | "NO_SESSION"
        | "EXPIRED"
        | "TENANT_BOUNDARY"
        | "CLIENT_BOUNDARY"
        | "ROLE_REQUIRED"
        | "MFA_REQUIRED"
        | "DISABLED";
    };

const ACTION_ROLES: Record<Action, readonly Role[]> = {
  CLIENT_READ: ["ANALYST", "CHECKER", "RISK_MANAGER", "ADMIN", "AUDITOR"],
  CASE_READ: ["ANALYST", "CHECKER", "RISK_MANAGER", "ADMIN", "AUDITOR"],
  CASE_PROPOSE: ["ANALYST", "RISK_MANAGER"],
  CASE_CHECK: ["CHECKER", "RISK_MANAGER"],
  POLICY_EDIT: ["RISK_MANAGER"],
  AUDIT_READ: ["AUDITOR", "RISK_MANAGER"],
  CONNECTION_MANAGE: ["ADMIN"],
  USER_ADMIN: ["ADMIN"],
  FUNDING_EXECUTE: [],
};
const MFA_ACTIONS = new Set<Action>([
  "CASE_CHECK",
  "POLICY_EDIT",
  "AUDIT_READ",
  "CONNECTION_MANAGE",
  "USER_ADMIN",
]);

/**
 * Always deny by default. Never accept principal details directly from
 * request bodies, cookies, URL params or form fields.
 */
export function authorize(
  actor: IdentityContext | null,
  target: AccessTarget,
  action: Action,
  nowMs: number,
): AccessDecision {
  if (
    !actor ||
    !actor.subject.trim() ||
    !actor.issuer.trim() ||
    !actor.tenantId.trim()
  )
    return { allowed: false, reason: "NO_SESSION" };
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(actor.authenticatedUntilMs) ||
    actor.authenticatedUntilMs <= nowMs
  )
    return { allowed: false, reason: "EXPIRED" };
  if (target.tenantId !== actor.tenantId || !target.tenantId.trim())
    return { allowed: false, reason: "TENANT_BOUNDARY" };
  if (
    target.clientId !== undefined &&
    (!target.clientId.trim() || !actor.clientGrants.includes(target.clientId))
  )
    return { allowed: false, reason: "CLIENT_BOUNDARY" };
  if (action === "FUNDING_EXECUTE")
    return { allowed: false, reason: "DISABLED" };
  if (!ACTION_ROLES[action].some((role) => actor.roles.includes(role)))
    return { allowed: false, reason: "ROLE_REQUIRED" };
  if (MFA_ACTIONS.has(action) && !actor.mfaSatisfied)
    return { allowed: false, reason: "MFA_REQUIRED" };
  return { allowed: true, reason: "AUTHORIZED" };
}

export function requireAccess(
  actor: IdentityContext | null,
  target: AccessTarget,
  action: Action,
  nowMs: number,
): void {
  const decision = authorize(actor, target, action, nowMs);
  if (!decision.allowed) throw new Error(`Access denied: ${decision.reason}`);
}
