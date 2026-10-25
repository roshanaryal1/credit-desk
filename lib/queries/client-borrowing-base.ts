import "server-only";

import type { Db } from "@/lib/db/client";
import type {
  BorrowingBaseReport,
  BorrowingPolicy,
  Receivable,
} from "@/lib/credit/borrowing-base";
import { clientBorrowingReview } from "./client-borrowing-review";

export interface IndicativeBorrowingBase {
  status: "SCENARIO_ONLY" | "NO_SOURCE_RECORDS";
  clientId: string;
  asOfDate: string;
  report: BorrowingBaseReport | null;
  baselinePolicy: BorrowingPolicy;
  sourceReceivables: Receivable[];
  assumptions: readonly string[];
  sourceInvoiceIds: string[];
}

const assumptions = [
  "Synthetic as-of ledger only; provider freshness and knowledge-time provenance are not verified.",
  "Contract terms are the current seeded client terms, not an approved historic facility policy.",
  "Hypothetical 50% per-debtor concentration cap; invoices over 90 days past due are excluded.",
  "Zero scenario reserve; actual reserves, disputes, debtor limits, security and other ineligibles remain unverified.",
  "Illustrative mathematical headroom is NOT approved drawable funding or a lending recommendation.",
];

/**
 * Builds a labelled scenario from the SAME synthetic client dossier and
 * effective-dated receivables that power Client 360. No invented receivables.
 * This cannot be used for real drawdowns or for a production borrowing base.
 */
export async function indicativeClientBorrowingBase(
  db: Db,
  clientId: string,
  asOfDate: string,
): Promise<IndicativeBorrowingBase | null> {
  const review = await clientBorrowingReview(db, clientId, asOfDate);
  if (!review) return null;
  const sourceInvoiceIds = review.evidence.ledgerInvoiceIds;
  return {
    status: sourceInvoiceIds.length ? "SCENARIO_ONLY" : "NO_SOURCE_RECORDS",
    clientId,
    asOfDate,
    report: sourceInvoiceIds.length ? review.report : null,
    baselinePolicy: review.policy,
    sourceReceivables: review.receivables,
    assumptions,
    sourceInvoiceIds,
  };
}
