import "server-only";

import { and, eq, inArray, lte } from "drizzle-orm";

import {
  borrowingBase,
  type BorrowingPolicy,
  type Receivable,
} from "@/lib/credit/borrowing-base";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { getClientReceivablesAgeing } from "@/lib/queries/client-ageing";
import { getClientDossier } from "@/lib/queries/client-360";

/**
 * Underwriting preview over dated, synthetic accounting records. Unlike the
 * original hand-entered worksheet this is scoped to one client and uses the
 * real demo ledger allocations. It never represents a certified draw limit.
 */
export async function clientBorrowingReview(
  db: Db,
  clientId: string,
  asOf: string,
) {
  if (!clientId.trim()) return null;
  const [ageing, dossier] = await Promise.all([
    getClientReceivablesAgeing(db, clientId, asOf),
    getClientDossier(db, clientId, asOf),
  ]);
  if (!ageing || !dossier) return null;

  const invoiceRows = ageing.debtors.flatMap((d) => d.invoices);
  const ids = invoiceRows.map((r) => r.invoiceId);

  // The ledger snapshot is already dated by the ageing read model; status
  // events are a distinct effective-dated feed and must be validated too.
  const statusRows = ids.length
    ? await db
        .select()
        .from(t.ledgerStatusEvents)
        .where(
          and(
            inArray(t.ledgerStatusEvents.ledgerEntryId, ids),
            lte(t.ledgerStatusEvents.effectiveDate, asOf),
          ),
        )
    : [];
  const byInvoice = new Map<
    string,
    { status: string; effectiveDate: string; ambiguous: boolean }
  >();
  for (const event of statusRows) {
    const previous = byInvoice.get(event.ledgerEntryId);
    if (
      previous &&
      previous.effectiveDate === event.effectiveDate &&
      previous.status !== event.status
    ) {
      byInvoice.set(event.ledgerEntryId, {
        ...previous,
        ambiguous: true,
      });
    } else if (!previous || event.effectiveDate > previous.effectiveDate) {
      byInvoice.set(event.ledgerEntryId, {
        status: event.status,
        effectiveDate: event.effectiveDate,
        ambiguous: false,
      });
    }
  }

  const receivables: Receivable[] = invoiceRows.map((r) => {
    const state = byInvoice.get(r.invoiceId);
    const ineligibleReasons: string[] = [];
    if (!state) ineligibleReasons.push("STATUS_UNVERIFIED");
    else if (state.ambiguous) ineligibleReasons.push("STATUS_CONFLICT");
    else if (state.status !== "AUTHORISED") {
      ineligibleReasons.push(`STATUS_${state.status}`);
    }
    if (r.daysPastDue > 90) ineligibleReasons.push("OVER_90_DAYS");
    return {
      invoiceId: r.invoiceId,
      debtorId: r.debtorId,
      faceCents:
        r.outstandingCents +
        r.countedReceiptCents +
        r.countedCreditCents,
      receivedCents: r.countedReceiptCents,
      creditNoteCents: r.countedCreditCents,
      ineligibleReasons,
    };
  });

  // Deliberately explicit sandbox policy. Concentration and reserve rules
  // have NOT been signed by a lender, so the computed number is never
  // presented as an amount the borrower could actually draw.
  const policy: BorrowingPolicy = {
    version: "SYNTHETIC-WORKSHEET-ONLY",
    advanceRateBps: dossier.client.advanceRateBps,
    maximumDebtorShareBps: 5000,
    facilityLimitCents: dossier.client.facilityLimitCents,
    drawnCents: dossier.inUseCents,
    reservesCents: 0,
  };
  const report = borrowingBase(asOf, policy, receivables);
  const accountedNet = receivables.reduce(
    (total, row) =>
      total + row.faceCents - row.receivedCents - row.creditNoteCents,
    0,
  );
  if (
    !Number.isSafeInteger(accountedNet) ||
    accountedNet !== ageing.totalOutstandingCents ||
    !Number.isSafeInteger(dossier.inUseCents)
  ) {
    throw new Error("Client borrowing-base input reconciliation failed");
  }

  return {
    clientId,
    clientName: dossier.client.name,
    asOf,
    report,
    policy,
    ageing,
    evidence: {
      ledgerInvoiceIds: ids,
      datedStatusEvents: statusRows.length,
      excludedInvoices: report.treatments.filter((row) => row.excludedCents > 0)
        .length,
    },
    releaseStatus: "NOT_VERIFIED_FOR_DRAWING" as const,
    blockers: [
      "No lender-approved concentration, reserve or contractual eligibility policy",
      "No verified provider sync and knowledge-time source checkpoint",
      "No authenticated dual-control approval or live banking reconciliation",
    ],
  };
}
