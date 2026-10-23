import { CHECK_CONFIG } from "@/lib/checks/config";
import type { CheckId } from "@/lib/checks/types";

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export interface CheckMetrics extends Confusion {
  /** null when there are no predicted positives (precision undefined). */
  precision: number | null;
  /** null when there are no labelled positives (recall undefined). */
  recall: number | null;
}

export const CHECK_IDS = Object.keys(CHECK_CONFIG.minimumMetrics) as CheckId[];

/**
 * Per-check confusion counts. `predicted` and `expected` map invoice id to
 * the check ids that fired and the check ids labelled, respectively.
 */
export function scoreChecks(
  predicted: Map<string, Set<string>>,
  expected: Map<string, Set<string>>,
): Record<CheckId, CheckMetrics> {
  const out = {} as Record<CheckId, CheckMetrics>;
  for (const check of CHECK_IDS) {
    const c: Confusion = { tp: 0, fp: 0, fn: 0, tn: 0 };
    for (const [invoiceId, labels] of expected) {
      const fired = predicted.get(invoiceId)?.has(check) ?? false;
      const labelled = labels.has(check);
      if (fired && labelled) c.tp++;
      else if (fired) c.fp++;
      else if (labelled) c.fn++;
      else c.tn++;
    }
    out[check] = {
      ...c,
      precision: c.tp + c.fp === 0 ? null : c.tp / (c.tp + c.fp),
      recall: c.tp + c.fn === 0 ? null : c.tp / (c.tp + c.fn),
    };
  }
  return out;
}

export interface GateFailure {
  check: CheckId;
  metric: "precision" | "recall";
  value: number | null;
  minimum: number;
}

/** Checks whose holdout precision or recall is below the configured minimum. */
export function gateFailures(
  metrics: Record<CheckId, CheckMetrics>,
): GateFailure[] {
  const failures: GateFailure[] = [];
  for (const check of CHECK_IDS) {
    const min = CHECK_CONFIG.minimumMetrics[check];
    for (const metric of ["precision", "recall"] as const) {
      const value = metrics[check][metric];
      // A metric with no positives cannot be gated; it is reported as n/a.
      if (value !== null && value < min[metric]) {
        failures.push({ check, metric, value, minimum: min[metric] });
      }
    }
  }
  return failures;
}
