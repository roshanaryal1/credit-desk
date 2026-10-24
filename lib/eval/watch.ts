import type { WatchRuleId } from "@/lib/watch/config";

// Watch rule scoring (SPEC 9.4): an incident matches a label when rule and
// incident key match and its first detection falls inside the label window.

export interface IncidentRow {
  ruleId: string;
  incidentKey: string;
  firstDetectedDate: string;
}

export interface WatchLabelRow {
  ruleId: string;
  incidentKey: string;
  expectedFromDate: string;
  expectedToDate: string;
}

export interface RuleMetrics {
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
}

export const WATCH_RULE_IDS: WatchRuleId[] = [
  "PAYMENT_DRIFT",
  "FUNDED_CREDIT_NOTE",
  "OVERDUE_FUNDED",
  "CONCENTRATION_CREEP",
  "FACILITY_UTILISATION",
];

export function scoreWatch(
  incidents: IncidentRow[],
  labels: WatchLabelRow[],
): Record<WatchRuleId, RuleMetrics> {
  const out = {} as Record<WatchRuleId, RuleMetrics>;
  for (const rule of WATCH_RULE_IDS) {
    const inc = incidents.filter((i) => i.ruleId === rule);
    const lab = labels.filter((l) => l.ruleId === rule);
    const matches = (i: IncidentRow, l: WatchLabelRow) =>
      i.incidentKey === l.incidentKey &&
      i.firstDetectedDate >= l.expectedFromDate &&
      i.firstDetectedDate <= l.expectedToDate;
    const tp = inc.filter((i) => lab.some((l) => matches(i, l))).length;
    const fp = inc.length - tp;
    const fn = lab.filter((l) => !inc.some((i) => matches(i, l))).length;
    out[rule] = {
      tp,
      fp,
      fn,
      precision: tp + fp === 0 ? null : tp / (tp + fp),
      recall: tp + fn === 0 ? null : tp / (tp + fn),
    };
  }
  return out;
}
