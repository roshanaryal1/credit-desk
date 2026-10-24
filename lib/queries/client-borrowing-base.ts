import "server-only";

import type { Db } from "@/lib/db/client";
import {
  borrowingBase,
  type BorrowingBaseReport,
  type Receivable,
} from "@/lib/credit/borrowing-base";
import { getClientDossier } from "@/lib/queries/client-360";
import { getClientReceivablesAgeing } from "@/lib/queries/client-ageing";

export interface IndicativeBorrowingBase {
  status: "SCENARIO_ONLY" | "NO_SOURCE_RECORDS";
  clientId: string;
  asOfDate: string;
  report: BorrowingBaseReport | null;
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
  const [dossier, ageing] = await Promise.all([
    getClientDossier(db, clientId, asOfDate),
    getClientReceivablesAgeing(db, clientId, asOfDate),
  ]);
  if (!dossier || !ageing) return null;
  if (dossier.client.id !== ageing.clientId || dossier.asOf !== ageing.asOf) {
    throw new Error("Borrowing-base client/date mismatch");
  }

  const sourceRows = ageing.debtors.flatMap((debtor) =>
    debtor.invoices.map((invoice): Receivable => {
      const face =
        invoice.outstandingCents +
        invoice.countedReceiptCents +
        invoice.countedCreditCents;
      if (!Number.isSafeInteger(face) || face < 0) {
        throw new Error("Unsafe source receivable amount");
      }
      return {
        invoiceId: invoice.invoiceId,
        debtorId: debtor.debtorId,
        faceCents: face,
        receivedCents: invoice.countedReceiptCents,
        creditNoteCents: invoice.countedCreditCents,
        ineligibleReasons:
          invoice.daysPastDue > 90 ? ["AGE_OVER_90_DAYS"] : [],
      };
    }),
  );

  // An empty / missing source is UNKNOWN, not zero eligible collateral.
  if (sourceRows.length === 0) {
    return {
      status: "NO_SOURCE_RECORDS",
      clientId,
      asOfDate,
      report: null,
      assumptions,
      sourceInvoiceIds: [],
    };
  }
  const totalOutstanding = sourceRows.reduce(
    (sum, row) =>
      sum + row.faceCents - row.receivedCents - row.creditNoteCents,
    0,
  );
  if (
    !Number.isSafeInteger(totalOutstanding) ||
    totalOutstanding !== ageing.totalOutstandingCents
  ) {
    throw new Error("Borrowing-base inputs do not reconcile to Client 360");
  }

  const report = borrowingBase(
    asOfDate,
    {
      version: "ILLUSTRATIVE-NOT-APPROVED",
      advanceRateBps: dossier.client.advanceRateBps,
      maximumDebtorShareBps: 5000,
      facilityLimitCents: dossier.client.facilityLimitCents,
      drawnCents: dossier.inUseCents,
      reservesCents: 0,
    },
    sourceRows,
  );
  if (report.netReceivablesCents !== ageing.totalOutstandingCents) {
    throw new Error("Borrowing-base report reconciliation failure");
  }
  return {
    status: "SCENARIO_ONLY",
    clientId,
    asOfDate,
    report,
    assumptions,
    sourceInvoiceIds: report.treatments.map((item) => item.invoiceId),
  };
}
