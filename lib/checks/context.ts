import { and, asc, desc, eq, gte, lt, lte } from "drizzle-orm";

import { validatedReceiptAllocations } from "@/lib/data/receipt-reconciliation";

import { CHECK_CONFIG } from "@/lib/checks/config";
import type {
  CheckContext,
  LedgerStatus,
  OutstandingFaceValue,
} from "@/lib/checks/types";
import { addDays } from "@/lib/dates";
import type { Db } from "@/lib/db/client";
import {
  bankTransactions,
  batches,
  clients,
  creditNotes,
  debtorPayments,
  debtors,
  fundingAdjustments,
  fundings,
  invoices,
  ledgerEntries,
  ledgerStatusEvents,
  receiptAllocations,
} from "@/lib/db/schema";

export async function buildCheckContext(
  db: Db,
  invoiceId: string,
): Promise<CheckContext> {
  const [subject] = await db
    .select({
      invoice: invoices,
      batch: batches,
      client: clients,
      debtor: debtors,
    })
    .from(invoices)
    .innerJoin(batches, eq(invoices.batchId, batches.id))
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .innerJoin(
      debtors,
      and(eq(invoices.debtorId, debtors.id), eq(debtors.clientId, clients.id)),
    )
    .where(eq(invoices.id, invoiceId));
  if (!subject) throw new Error(`Invoice context not found: ${invoiceId}`);
  const { invoice, batch, client, debtor } = subject;
  if (batch.clientId !== client.id)
    throw new Error(`Batch client mismatch: ${batch.id}`);
  const asOf = batch.submittedDate;

  const [
    ledgerRows,
    statusRows,
    notes,
    receipts,
    submitted,
    payments,
    priorPayments,
    fundedRows,
    adjustmentRows,
  ] = await Promise.all([
    db
      .select()
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.clientId, client.id),
          lte(ledgerEntries.recordedDate, asOf),
        ),
      )
      .orderBy(asc(ledgerEntries.id)),
    db
      .select({ event: ledgerStatusEvents })
      .from(ledgerStatusEvents)
      .innerJoin(
        ledgerEntries,
        eq(ledgerStatusEvents.ledgerEntryId, ledgerEntries.id),
      )
      .where(
        and(
          eq(ledgerEntries.clientId, client.id),
          lte(ledgerEntries.recordedDate, asOf),
          lte(ledgerStatusEvents.effectiveDate, asOf),
        ),
      )
      .orderBy(
        desc(ledgerStatusEvents.effectiveDate),
        asc(ledgerStatusEvents.ledgerEntryId),
      ),
    db
      .select({ note: creditNotes })
      .from(creditNotes)
      .innerJoin(ledgerEntries, eq(creditNotes.ledgerEntryId, ledgerEntries.id))
      .where(
        and(
          eq(ledgerEntries.clientId, client.id),
          eq(ledgerEntries.invoiceNumber, invoice.invoiceNumber),
          lte(ledgerEntries.recordedDate, asOf),
          lte(creditNotes.date, asOf),
        ),
      )
      .orderBy(asc(creditNotes.id)),
    db
      .select({
        allocation: receiptAllocations,
        bankTransaction: bankTransactions,
      })
      .from(receiptAllocations)
      .innerJoin(
        ledgerEntries,
        eq(receiptAllocations.ledgerEntryId, ledgerEntries.id),
      )
      .innerJoin(
        bankTransactions,
        eq(receiptAllocations.bankTransactionId, bankTransactions.id),
      )
      .where(
        and(
          eq(ledgerEntries.clientId, client.id),
          eq(ledgerEntries.invoiceNumber, invoice.invoiceNumber),
          lte(ledgerEntries.recordedDate, asOf),
          lt(bankTransactions.date, asOf),
        ),
      )
      .orderBy(asc(bankTransactions.id)),
    db
      .select({ invoice: invoices, submittedDate: batches.submittedDate })
      .from(invoices)
      .innerJoin(batches, eq(invoices.batchId, batches.id))
      .where(
        and(
          eq(invoices.clientId, client.id),
          eq(batches.clientId, client.id),
          lte(batches.submittedDate, asOf),
        ),
      )
      .orderBy(asc(invoices.id)),
    db
      .select()
      .from(debtorPayments)
      .where(
        and(
          eq(debtorPayments.debtorId, debtor.id),
          gte(
            debtorPayments.paidDate,
            addDays(asOf, -CHECK_CONFIG.slowPayerLookbackDays),
          ),
          lt(debtorPayments.paidDate, asOf),
        ),
      )
      .orderBy(asc(debtorPayments.paidDate), asc(debtorPayments.id)),
    db
      .select()
      .from(debtorPayments)
      .where(
        and(
          eq(debtorPayments.debtorId, debtor.id),
          lt(debtorPayments.paidDate, asOf),
        ),
      )
      .orderBy(desc(debtorPayments.paidDate), asc(debtorPayments.id))
      .limit(1),
    db
      .select({ funding: fundings, invoice: invoices })
      .from(fundings)
      .innerJoin(invoices, eq(fundings.invoiceId, invoices.id))
      .innerJoin(batches, eq(invoices.batchId, batches.id))
      .where(
        and(
          eq(invoices.clientId, client.id),
          eq(batches.clientId, client.id),
          lte(batches.submittedDate, asOf),
          lte(fundings.fundedDate, asOf),
        ),
      )
      .orderBy(asc(fundings.id)),
    db
      .select({ adjustment: fundingAdjustments })
      .from(fundingAdjustments)
      .innerJoin(fundings, eq(fundingAdjustments.fundingId, fundings.id))
      .innerJoin(invoices, eq(fundings.invoiceId, invoices.id))
      .where(
        and(
          eq(invoices.clientId, client.id),
          lte(fundings.fundedDate, asOf),
          lte(fundingAdjustments.date, asOf),
        ),
      )
      .orderBy(asc(fundingAdjustments.id)),
  ]);

  await validatedReceiptAllocations(db, client.id, [
    ...new Map(
      receipts.map(({ bankTransaction }) => [
        bankTransaction.id,
        bankTransaction,
      ]),
    ).values(),
  ]);

  const statuses = new Map<
    string,
    { status: LedgerStatus; effectiveDate: string }
  >();
  for (const { event } of statusRows) {
    const latest = statuses.get(event.ledgerEntryId);
    // The schema has no intra-day sequence, so conflicting latest events cannot be ordered.
    if (
      latest?.effectiveDate === event.effectiveDate &&
      latest.status !== event.status
    ) {
      throw new Error(
        `Ambiguous ledger status: ${event.ledgerEntryId} on ${event.effectiveDate}`,
      );
    }
    if (!latest) statuses.set(event.ledgerEntryId, event);
  }
  const ledgerByNumber = new Map(
    ledgerRows.map((entry) => [entry.invoiceNumber, entry]),
  );
  const ledger = ledgerByNumber.get(invoice.invoiceNumber);
  const adjustmentsByFunding = new Map<
    string,
    (typeof fundingAdjustments.$inferSelect)[]
  >();
  for (const { adjustment } of adjustmentRows) {
    const rows = adjustmentsByFunding.get(adjustment.fundingId) ?? [];
    rows.push(adjustment);
    adjustmentsByFunding.set(adjustment.fundingId, rows);
  }
  const outstandingByDebtor = new Map<string, OutstandingFaceValue>();
  for (const { funding, invoice: fundedInvoice } of fundedRows) {
    const adjustments = adjustmentsByFunding.get(funding.id) ?? [];
    const outstandingCents =
      funding.advanceCents -
      adjustments.reduce((sum, adjustment) => sum + adjustment.amountCents, 0);
    if (outstandingCents <= 0) continue;
    const value = outstandingByDebtor.get(fundedInvoice.debtorId) ?? {
      debtorId: fundedInvoice.debtorId,
      amountCents: 0,
      invoices: [],
    };
    // Face value stays whole while any funded exposure remains (SPEC 6).
    value.amountCents += fundedInvoice.amountCents;
    value.invoices.push({
      invoiceId: fundedInvoice.id,
      amountCents: fundedInvoice.amountCents,
      fundingId: funding.id,
      fundedDate: funding.fundedDate,
      advanceCents: funding.advanceCents,
      outstandingCents,
      adjustments,
    });
    outstandingByDebtor.set(fundedInvoice.debtorId, value);
  }

  return {
    invoice,
    submittedDate: asOf,
    client: {
      id: client.id,
      advanceRateBps: client.advanceRateBps,
      paymentTermsDays: client.paymentTermsDays,
    },
    debtor: { id: debtor.id, firstSeenDate: debtor.firstSeenDate },
    ledgerEntry: ledger
      ? {
          ...ledger,
          status: statuses.get(ledger.id)?.status ?? null,
          creditNotes: notes.map(({ note }) => note),
        }
      : null,
    receiptAllocations: receipts.map(({ allocation, bankTransaction }) => ({
      ...allocation,
      bankTransaction,
    })),
    otherInvoices: submitted
      .filter(({ invoice: other }) => other.id !== invoice.id)
      .map(({ invoice: other, submittedDate }) => {
        const otherLedger = ledgerByNumber.get(other.invoiceNumber);
        return {
          ...other,
          submittedDate,
          ledgerEntryId: otherLedger?.id ?? null,
          ledgerStatus: otherLedger
            ? (statuses.get(otherLedger.id)?.status ?? null)
            : null,
        };
      }),
    supersededLedgerEntryIds:
      ledger?.supersedesLedgerEntryId &&
      ledgerRows.some((entry) => entry.id === ledger.supersedesLedgerEntryId)
        ? [ledger.supersedesLedgerEntryId]
        : [],
    debtorPayments: payments,
    priorPayment: priorPayments[0] ?? null,
    outstandingFaceValueByDebtor: [...outstandingByDebtor.values()],
    batchInvoices: submitted
      .filter(({ invoice: other }) => other.batchId === batch.id)
      .map(({ invoice: other }) => other),
  };
}
