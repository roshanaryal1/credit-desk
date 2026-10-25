import { addDays, daysBetween } from "@/lib/dates";
import type { CaseWorkRow } from "@/lib/queries/demo-cases";

export type CaseSlaStage =
  | "CLOSED"
  | "NO_DEADLINE"
  | "ON_TRACK"
  | "DUE_TODAY"
  | "NONWORKING_DAY_GRACE"
  | "BREACHED"
  | "CRITICAL";

export interface CaseSlaPolicy {
  warningBusinessDays: number;
  criticalBusinessDays: number;
  /** Injected lender-approved holidays; absent means weekends-only preview. */
  holidays?: readonly string[];
  version: string;
}

export const SYNTHETIC_SLA_POLICY: CaseSlaPolicy = {
  version: "fictional-weekdays-v1",
  warningBusinessDays: 1,
  criticalBusinessDays: 3,
};

const TERMINAL = new Set(["APPROVED", "HELD", "REJECTED", "CLOSED"]);

function validate(policy: CaseSlaPolicy) {
  if (
    !policy.version.trim() ||
    !Number.isSafeInteger(policy.warningBusinessDays) ||
    !Number.isSafeInteger(policy.criticalBusinessDays) ||
    policy.warningBusinessDays < 1 ||
    policy.criticalBusinessDays < policy.warningBusinessDays ||
    policy.criticalBusinessDays > 365
  ) {
    throw new Error("Invalid versioned case SLA policy");
  }
  const holidays = new Set(policy.holidays ?? []);
  for (const date of holidays) daysBetween(date, date);
  if (holidays.size !== (policy.holidays?.length ?? 0)) {
    throw new Error("Duplicate business-day holiday");
  }
  return holidays;
}

export function elapsedBusinessDays(
  dueDate: string,
  asOf: string,
  holidays: ReadonlySet<string> = new Set(),
): number {
  const countDays = daysBetween(dueDate, asOf);
  if (Math.abs(countDays) > 3660) {
    throw new Error("SLA date range is unreasonably large");
  }
  if (countDays <= 0) return 0;
  let days = 0;
  for (let n = 1; n <= countDays; n++) {
    const date = addDays(dueDate, n);
    const weekday = new Date(date + "T00:00:00Z").getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(date)) days++;
  }
  return days;
}

/**
 * Pure candidate priority for a fictional credit case. Returns a stable
 * notification key for future verified outbox processing, but does not
 * deliver notifications or authorize approvals.
 */
export function classifyCaseSla(
  row: CaseWorkRow,
  asOf: string,
  policy: CaseSlaPolicy = SYNTHETIC_SLA_POLICY,
) {
  const holidays = validate(policy);
  daysBetween(asOf, asOf);
  if (!row.id.trim() || !Number.isSafeInteger(row.version) || row.version < 0) {
    throw new Error("Invalid case identity or version");
  }
  const terminal = TERMINAL.has(row.state);
  let stage: CaseSlaStage;
  let businessDaysLate = 0;
  if (terminal) {
    stage = "CLOSED";
  } else if (row.dueDate === null) {
    stage = "NO_DEADLINE";
  } else {
    const calendarDifference = daysBetween(row.dueDate, asOf);
    businessDaysLate = elapsedBusinessDays(row.dueDate, asOf, holidays);
    stage =
      calendarDifference < 0
        ? "ON_TRACK"
        : calendarDifference === 0
          ? "DUE_TODAY"
          : businessDaysLate === 0
            ? "NONWORKING_DAY_GRACE"
            : businessDaysLate >= policy.criticalBusinessDays
              ? "CRITICAL"
              : businessDaysLate >= policy.warningBusinessDays
                ? "BREACHED"
                : "ON_TRACK";
  }
  const noticeCandidate =
    stage === "BREACHED" || stage === "CRITICAL"
      ? [row.id, row.version, policy.version, stage].join(":")
      : null;
  return {
    caseId: row.id,
    clientId: row.clientId,
    asOf,
    stage,
    businessDaysLate,
    noticeCandidate,
    policyVersion: policy.version,
    calendarEvidence:
      policy.holidays === undefined
        ? ("WEEKDAYS_ONLY" as const)
        : ("INJECTED_HOLIDAYS" as const),
    dueDate: row.dueDate,
    state: row.state,
    priority: row.priority,
    clientName: row.clientName,
    ownerId: row.ownerId,
  };
}

export function syntheticCaseSlaQueue(
  rows: readonly CaseWorkRow[],
  asOf: string,
  policy: CaseSlaPolicy = SYNTHETIC_SLA_POLICY,
) {
  const ranked = [...rows].map((row) => classifyCaseSla(row, asOf, policy));
  const order: Record<CaseSlaStage, number> = {
    CRITICAL: 0,
    BREACHED: 1,
    DUE_TODAY: 2,
    NONWORKING_DAY_GRACE: 3,
    ON_TRACK: 4,
    NO_DEADLINE: 5,
    CLOSED: 6,
  };
  return ranked.sort(
    (a, b) =>
      order[a.stage] - order[b.stage] ||
      b.businessDaysLate - a.businessDaysLate ||
      a.caseId.localeCompare(b.caseId),
  );
}
