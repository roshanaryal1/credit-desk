/**
 * Credit case transition domain. This is not authorization middleware.
 * The calling server MUST obtain VerifiedActor from a trusted identity
 * provider and enforce tenant scope in the database (#109).
 *
 * A proposed decision never moves money or creates a funding entry.
 */
export type CaseRole = "ANALYST" | "CHECKER" | "RISK_MANAGER" | "AUDITOR";
export type CaseState =
  | "NEW"
  | "ASSIGNED"
  | "IN_REVIEW"
  | "CHECKER_REVIEW"
  | "RETURNED"
  | "APPROVED"
  | "HELD"
  | "REJECTED"
  | "CLOSED";

export interface VerifiedActor {
  subjectId: string;
  roles: CaseRole[];
  clientIds: string[];
}

export interface CreditCase {
  caseId: string;
  clientId: string;
  state: CaseState;
  version: number;
  ownerId: string | null;
  makerId: string | null;
  checkerId: string | null;
  decisionReason: string | null;
}

export type CaseAction =
  | { kind: "ASSIGN"; ownerId: string }
  | { kind: "START" }
  | { kind: "SUBMIT_FOR_CHECK" }
  | { kind: "APPROVE"; reason: string }
  | { kind: "HOLD"; reason: string }
  | { kind: "REJECT"; reason: string }
  | { kind: "RETURN"; reason: string }
  | { kind: "REOPEN" }
  | { kind: "CLOSE" };

export interface CaseEvent {
  caseId: string;
  clientId: string;
  from: CaseState;
  to: CaseState;
  version: number;
  actorId: string;
  action: CaseAction["kind"];
  reason: string | null;
  occurredAt: string;
}

export interface CaseTransition {
  next: CreditCase;
  event: CaseEvent;
}

function permitted(actor: VerifiedActor, role: CaseRole): boolean {
  return actor.roles.includes(role);
}

function requireRole(actor: VerifiedActor, role: CaseRole): void {
  if (!permitted(actor, role)) throw new Error(`Requires ${role} role`);
}

function reasoned(reason: string): string {
  if (typeof reason !== "string" || reason.trim().length < 8) {
    throw new Error("A substantive decision reason is required");
  }
  return reason.trim();
}

/**
 * Compute a single transition to be committed in one DB transaction using
 * expectedVersion as a compare-and-swap guard. Do not use this function as
 * the only protection against concurrent requests or forged actor claims.
 */
export function transitionCase(
  current: CreditCase,
  action: CaseAction,
  actor: VerifiedActor,
  expectedVersion: number,
  occurredAt: string,
): CaseTransition {
  if (!actor.subjectId || !actor.clientIds.includes(current.clientId)) {
    throw new Error("Actor is not authorized for this client");
  }
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== current.version) {
    throw new Error("Stale case version; reload before deciding");
  }
  if (
    !Number.isSafeInteger(current.version) ||
    current.version < 0 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(occurredAt) ||
    !Number.isFinite(Date.parse(occurredAt))
  ) {
    throw new Error("Invalid case version or UTC event instant");
  }

  const next: CreditCase = { ...current, version: current.version + 1 };
  let reason: string | null = null;
  switch (action.kind) {
    case "ASSIGN":
      requireRole(actor, "RISK_MANAGER");
      if (!["NEW", "ASSIGNED", "RETURNED"].includes(current.state)) {
        throw new Error("Cannot assign a case in this state");
      }
      if (!action.ownerId.trim()) throw new Error("Owner is required");
      next.state = "ASSIGNED";
      next.ownerId = action.ownerId;
      break;

    case "START":
      requireRole(actor, "ANALYST");
      if (!["ASSIGNED", "RETURNED"].includes(current.state)) {
        throw new Error("Case must be assigned or returned");
      }
      if (current.ownerId !== actor.subjectId) {
        throw new Error("Only the assigned analyst may start review");
      }
      next.state = "IN_REVIEW";
      break;

    case "SUBMIT_FOR_CHECK":
      requireRole(actor, "ANALYST");
      if (current.state !== "IN_REVIEW" || current.ownerId !== actor.subjectId) {
        throw new Error("Only the current maker may submit an active case");
      }
      next.state = "CHECKER_REVIEW";
      next.makerId = actor.subjectId;
      next.checkerId = null;
      break;

    case "APPROVE":
    case "HOLD":
    case "REJECT":
    case "RETURN":
      requireRole(actor, "CHECKER");
      if (current.state !== "CHECKER_REVIEW") {
        throw new Error("Case is not awaiting checker review");
      }
      if (!current.makerId || current.makerId === actor.subjectId) {
        throw new Error("Maker and checker must be different verified identities");
      }
      reason = reasoned(action.reason);
      next.checkerId = actor.subjectId;
      next.decisionReason = reason;
      next.state =
        action.kind === "RETURN"
          ? "RETURNED"
          : action.kind === "APPROVE"
            ? "APPROVED"
            : action.kind === "HOLD"
              ? "HELD"
              : "REJECTED";
      break;

    case "REOPEN":
      requireRole(actor, "RISK_MANAGER");
      if (!["APPROVED", "HELD", "REJECTED"].includes(current.state)) {
        throw new Error("Only decided cases can be reopened");
      }
      next.state = "ASSIGNED";
      next.makerId = null;
      next.checkerId = null;
      next.decisionReason = null;
      break;

    case "CLOSE":
      requireRole(actor, "RISK_MANAGER");
      if (!["APPROVED", "HELD", "REJECTED"].includes(current.state)) {
        throw new Error("Only decided cases can be closed");
      }
      next.state = "CLOSED";
      break;
  }
  return {
    next,
    event: {
      caseId: current.caseId,
      clientId: current.clientId,
      from: current.state,
      to: next.state,
      version: next.version,
      actorId: actor.subjectId,
      action: action.kind,
      reason,
      occurredAt,
    },
  };
}
