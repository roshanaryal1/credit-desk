// Watch rule thresholds (SPEC 7). Versioned with the check config.
export { CONFIG_VERSION } from "@/lib/checks/config";

export const WATCH_CONFIG = {
  // Recent window for payment drift, in days ending on the as-of date.
  driftRecentDays: 60,
  // Prior comparison window, ending where the recent window starts.
  driftPriorDays: 90,
  // Minimum payments in each window before drift is assessed.
  driftMinPayments: 3,
  // Increase in mean days-to-pay that counts as drift.
  driftIncreaseDays: 15,
  // Days past due before a funded, outstanding invoice is overdue.
  overdueDays: 30,
  // A debtor's share of a client's outstanding exposure that counts as concentrated.
  concentrationBps: 3000,
  // Funds in use as a share of the facility limit that counts as nearly full.
  facilityBps: 9000,
} as const;

export type WatchRuleId =
  | "PAYMENT_DRIFT"
  | "FUNDED_CREDIT_NOTE"
  | "OVERDUE_FUNDED"
  | "CONCENTRATION_CREEP"
  | "FACILITY_UTILISATION";

export const WATCH_SEVERITY: Record<WatchRuleId, "LOW" | "MEDIUM" | "HIGH"> = {
  PAYMENT_DRIFT: "MEDIUM",
  FUNDED_CREDIT_NOTE: "HIGH",
  OVERDUE_FUNDED: "HIGH",
  CONCENTRATION_CREEP: "MEDIUM",
  FACILITY_UTILISATION: "LOW",
};

export const WATCH_LABELS: Record<WatchRuleId, string> = {
  PAYMENT_DRIFT: "Debtor paying more slowly",
  FUNDED_CREDIT_NOTE: "Credit note on a funded invoice",
  OVERDUE_FUNDED: "Funded invoice overdue",
  CONCENTRATION_CREEP: "Debtor concentration rising",
  FACILITY_UTILISATION: "Facility nearly full",
};
