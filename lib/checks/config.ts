import type { CheckId } from "@/lib/checks/types";

export const CONFIG_VERSION = "2026-10-23.1";

export const CHECK_CONFIG = {
  // A week catches near-date resubmissions of the same debtor and amount.
  duplicateWindowDays: 7,
  // Credit notes above 20% of submitted face value are high risk.
  creditNoteHighShareBps: 2000,
  // 99% allocation coverage tolerates small residual balances.
  alreadyPaidCoverageBps: 9900,
  // Debtors first seen within 60 days have limited observed history.
  newDebtorDays: 60,
  // Payment behaviour gets 30 days of grace beyond contractual terms.
  slowPayerGraceDays: 30,
  // Three payments are the minimum sample for a mean days-to-pay.
  slowPayerMinPayments: 3,
  // A fixed 365-day lookback makes the payment window reproducible.
  slowPayerLookbackDays: 365,
  // Invoices older than 90 calendar days are too old to fund.
  overAgeDays: 90,
  // A debtor share above 30% flags concentration before funding.
  concentrationBps: 3000,
  minimumMetrics: {
    // DUP must achieve at least 80% precision and recall in CI.
    DUP: { precision: 0.8, recall: 0.8 },
    // LEDGER_MISSING must achieve at least 80% precision and recall in CI.
    LEDGER_MISSING: { precision: 0.8, recall: 0.8 },
    // LEDGER_MISMATCH must achieve at least 80% precision and recall in CI.
    LEDGER_MISMATCH: { precision: 0.8, recall: 0.8 },
    // VOIDED must achieve at least 80% precision and recall in CI.
    VOIDED: { precision: 0.8, recall: 0.8 },
    // CREDIT_NOTE must achieve at least 80% precision and recall in CI.
    CREDIT_NOTE: { precision: 0.8, recall: 0.8 },
    // ALREADY_PAID must achieve at least 80% precision and recall in CI.
    ALREADY_PAID: { precision: 0.8, recall: 0.8 },
    // NEW_DEBTOR must achieve at least 80% precision and recall in CI.
    NEW_DEBTOR: { precision: 0.8, recall: 0.8 },
    // SLOW_PAYER must achieve at least 80% precision and recall in CI.
    SLOW_PAYER: { precision: 0.8, recall: 0.8 },
    // OVER_AGE must achieve at least 80% precision and recall in CI.
    OVER_AGE: { precision: 0.8, recall: 0.8 },
    // FUTURE_DATED must achieve at least 80% precision and recall in CI.
    FUTURE_DATED: { precision: 0.8, recall: 0.8 },
    // CONCENTRATION must achieve at least 80% precision and recall in CI.
    CONCENTRATION: { precision: 0.8, recall: 0.8 },
  } satisfies Record<CheckId, { precision: number; recall: number }>,
} as const;
