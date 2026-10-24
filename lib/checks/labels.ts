import type { CheckId } from "./types";

/** Plain-language names for check ids, shown to analysts. */
export const CHECK_LABELS: Record<CheckId, string> = {
  DUP: "Possible duplicate",
  LEDGER_MISSING: "Not in the client's ledger",
  LEDGER_MISMATCH: "Ledger disagrees",
  VOIDED: "Voided in the ledger",
  CREDIT_NOTE: "Credit note against it",
  ALREADY_PAID: "Already paid",
  NEW_DEBTOR: "New debtor",
  SLOW_PAYER: "Slow-paying debtor",
  OVER_AGE: "Too old to fund",
  FUTURE_DATED: "Dated in the future",
  CONCENTRATION: "Debtor concentration",
};

export const checkLabel = (id: string) => CHECK_LABELS[id as CheckId] ?? id;
