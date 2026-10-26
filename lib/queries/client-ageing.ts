import "server-only";

import { and, eq, inArray, lte } from "drizzle-orm";

import { validatedReceiptAllocations } from "@/lib/data/receipt-reconciliation";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { debtorAgeing } from "@/lib/risk/debtor-ageing";
import {
  collectionsInsights,
  type CollectionsReceivable,
} from "@/lib/risk/collections-insights";

function asOfDate(value: string): void {
  const millis = Date.parse(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(millis) ||
    new Date(millis).toISOString().slice(0, 10) !== value
  ) {
    throw new Error("A valid client as-of business date is required");
  }
}

function dueDate(issued: string, termsDays: number): string {
  if (!Number.isSafeInteger(termsDays) || termsDays < 0 || termsDays > 365) {
    throw new Error("Invalid synthetic facility payment terms");
  }
  const time = Date.parse(`${issued}T00:00:00Z`);
  return new Date(time + termsDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Synthetic ledger-based receivables ageing, distinct from funded exposure.
 * This is not a complete historic accounting feed or authorised borrowing
 * base. The prototype ledger has no knowledge-time revision history and
 * current client payment terms are used for due-date estimation.
 */
export async function getClientReceivablesAgeing(
  db: Db,
  clientId: string,
  asOf: string,
) {
  asOfDate(asOf);
  const [client] = await db
    .select()
    .from(t.clients)
    .where(eq(t.clients.id, clientId))
    .limit(1);
  if (!client) return null;

  const [ledgers, debtors] = await Promise.all([
    db
      .select()
      .from(t.ledgerEntries)
      .where(
        and(
          eq(t.ledgerEntries.clientId, clientId),
          lte(t.ledgerEntries.recordedDate, asOf),
          lte(t.ledgerEntries.issueDate, asOf),
        ),
      ),
    db.select().from(t.debtors).where(eq(t.debtors.clientId, clientId)),
  ]);

  if (!ledgers.length) {
    return {
      clientId,
      asOf,
      totalOutstandingCents: 0,
      overdueCents: 0,
      currentCents: 0,
      debtors: [],
      collections: [],
    };
  }

  const ledgerIds = ledgers.map((r) => r.id);
  const [credits, receiptRows] = await Promise.all([
    db
      .select()
      .from(t.creditNotes)
      .where(inArray(t.creditNotes.ledgerEntryId, ledgerIds)),
    db
      .select()
      .from(t.receiptAllocations)
      .where(inArray(t.receiptAllocations.ledgerEntryId, ledgerIds)),
  ]);
  const bankIds = [...new Set(receiptRows.map((r) => r.bankTransactionId))];
  const banks = bankIds.length
    ? await db
        .select()
        .from(t.bankTransactions)
        .where(
          and(
            lte(t.bankTransactions.date, asOf),
            inArray(t.bankTransactions.id, bankIds),
          ),
        )
    : [];
  const validated = await validatedReceiptAllocations(db, clientId, banks);
  const byBank = new Map(banks.map((b) => [b.id, b]));
  const debtorsById = new Map(debtors.map((d) => [d.id, d.name]));
  const byInvoice: CollectionsReceivable[] = ledgers.map((row) => {
    if (!debtorsById.has(row.debtorId)) {
      throw new Error("Ledger entry references debtor outside this client");
    }
    return {
      invoiceId: row.id,
      debtorId: row.debtorId,
      issuedDate: row.issueDate,
      recordedDate: row.recordedDate,
      dueDate: dueDate(row.issueDate, client.paymentTermsDays),
      faceCents: row.amountCents,
      receiptAllocations: validated.allocations
        .filter(
          (a) => a.ledgerEntryId === row.id && byBank.has(a.bankTransactionId),
        )
        .map((a) => {
          const bank = byBank.get(a.bankTransactionId);
          if (!bank) {
            throw new Error("Bank allocation source missing or outside client");
          }
          return {
            sourceId: `bank:${bank.id}:${row.id}`,
            effectiveDate: bank.date,
            cents: a.amountCents,
          };
        }),
      creditNotes: credits
        .filter((c) => c.ledgerEntryId === row.id)
        .map((c) => ({
          sourceId: `credit:${c.id}`,
          effectiveDate: c.date,
          cents: c.amountCents,
        })),
    };
  });

  const grouped = debtorAgeing(asOf, byInvoice).map((d) => ({
    ...d,
    debtorName: debtorsById.get(d.debtorId) ?? d.debtorId,
  }));

  const collections = collectionsInsights(asOf, byInvoice).map((d) => ({
    ...d,
    debtorName: debtorsById.get(d.debtorId) ?? d.debtorId,
  }));

  const totalOutstandingCents = grouped.reduce(
    (sum, d) => sum + d.grossOutstandingCents,
    0,
  );
  const overdueCents = grouped.reduce((sum, d) => sum + d.overdueCents, 0);
  const currentCents = totalOutstandingCents - overdueCents;
  if (
    !Number.isSafeInteger(totalOutstandingCents) ||
    !Number.isSafeInteger(overdueCents) ||
    !Number.isSafeInteger(currentCents)
  ) {
    throw new Error("Receivables ageing total overflow");
  }
  return {
    clientId,
    asOf,
    totalOutstandingCents,
    overdueCents,
    currentCents,
    debtors: grouped,
    collections,
  };
}
