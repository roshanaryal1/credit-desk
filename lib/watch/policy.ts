import type { WatchRuleId } from "./config";

export interface RiskPolicy {
  id: string;
  clientId: string;
  effectiveFrom: string;
  approvedBy: string;
  approvedAt: string;
  thresholds: {
    driftIncreaseDays: number;
    overdueDays: number;
    concentrationBps: number;
    facilityBps: number;
  };
  escalation: { mediumAfterDays: number; highAfterDays: number };
}

export type Escalation = "NONE" | "MEDIUM" | "HIGH";

function day(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid business date");
  const d = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(d) || new Date(d).toISOString().slice(0, 10) !== value)
    throw new Error("Invalid business date");
  return Math.floor(d / 86_400_000);
}

function validPolicy(p: RiskPolicy) {
  if (!p.id.trim() || !p.clientId.trim() || !p.approvedBy.trim())
    throw new Error("Policy requires id, client and reviewer");
  day(p.effectiveFrom);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(p.approvedAt) ||
      !p.approvedAt.endsWith("Z") || !Number.isFinite(Date.parse(p.approvedAt)))
    throw new Error("Policy approval must have a UTC instant");
  const t = p.thresholds;
  for (const value of [t.driftIncreaseDays, t.overdueDays])
    if (!Number.isSafeInteger(value) || value < 0 || value > 365)
      throw new Error("Invalid day threshold");
  for (const value of [t.concentrationBps, t.facilityBps])
    if (!Number.isInteger(value) || value < 0 || value > 10000)
      throw new Error("Invalid basis-point threshold");
  const {mediumAfterDays, highAfterDays} = p.escalation;
  if (!Number.isSafeInteger(mediumAfterDays) || !Number.isSafeInteger(highAfterDays) ||
      mediumAfterDays < 0 || highAfterDays < mediumAfterDays)
    throw new Error("Escalation windows must be ordered");
  if (Date.parse(p.approvedAt) > Date.parse(`${p.effectiveFrom}T23:59:59Z`))
    throw new Error("Unapproved policy cannot take historical effect");
}

/** Explicitly pinned policy for a client and business day; no backdated overwrite. */
export function selectRiskPolicy(
  policies: RiskPolicy[], clientId: string, asOf: string,
): RiskPolicy | null {
  const cutoff = day(asOf);
  const matching = policies.filter(p => {
    validPolicy(p);
    return p.clientId === clientId && day(p.effectiveFrom) <= cutoff;
  }).sort((a,b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  for (let i=1;i<matching.length;i++)
    if (matching[i]!.effectiveFrom === matching[i-1]!.effectiveFrom)
      throw new Error("Ambiguous effective policies for one client");
  return matching[0] ?? null;
}

export function escalateIncident(
  firstDetectedDate: string, asOf: string, status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED",
  policy: RiskPolicy,
): { level: Escalation; elapsedDays: number } {
  validPolicy(policy);
  const days = day(asOf) - day(firstDetectedDate);
  if (days < 0) throw new Error("Incident was detected after as-of date");
  if (status === "RESOLVED") return {level:"NONE",elapsedDays:days};
  return {
    level: days >= policy.escalation.highAfterDays
      ? "HIGH" : days >= policy.escalation.mediumAfterDays ? "MEDIUM" : "NONE",
    elapsedDays: days,
  };
}

export function thresholdForRule(policy: RiskPolicy, rule: WatchRuleId): number | null {
  validPolicy(policy);
  switch (rule) {
    case "PAYMENT_DRIFT": return policy.thresholds.driftIncreaseDays;
    case "OVERDUE_FUNDED": return policy.thresholds.overdueDays;
    case "CONCENTRATION_CREEP": return policy.thresholds.concentrationBps;
    case "FACILITY_UTILISATION": return policy.thresholds.facilityBps;
    case "FUNDED_CREDIT_NOTE": return null;
  }
}
