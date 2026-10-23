import { count, eq } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

import type { Dataset } from "./generate";

const CHUNK = 500;

async function insertAll<T extends Record<string, unknown>>(
  db: Db,
  table: Parameters<Db["insert"]>[0],
  rows: T[],
) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(table).values(rows.slice(i, i + CHUNK));
  }
}

/** Number of decisions made by people in the app (not simulated). */
export async function liveDecisionCount(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(t.decisions)
    .where(eq(t.decisions.simulated, false));
  return row?.n ?? 0;
}

/**
 * Inserts a dataset in foreign-key order. The caller is responsible for
 * starting from an empty schema (see scripts/seed.ts).
 */
export async function writeDataset(db: Db, ds: Dataset): Promise<void> {
  await insertAll(db, t.clients, ds.clients);
  await insertAll(db, t.debtors, ds.debtors);
  await insertAll(db, t.ledgerEntries, ds.ledgerEntries);
  await insertAll(db, t.ledgerStatusEvents, ds.ledgerStatusEvents);
  await insertAll(db, t.creditNotes, ds.creditNotes);
  await insertAll(db, t.bankTransactions, ds.bankTransactions);
  await insertAll(db, t.receiptAllocations, ds.receiptAllocations);
  await insertAll(db, t.debtorPayments, ds.debtorPayments);
  await insertAll(db, t.batches, ds.batches);
  await insertAll(db, t.invoices, ds.invoices);
  await insertAll(db, t.fundings, ds.fundings);
  await insertAll(db, t.fundingAdjustments, ds.fundingAdjustments);
  await insertAll(db, t.labels, ds.labels);
  await insertAll(db, t.watchLabels, ds.watchLabels);
}

/** Counts used by the seed summary and tests. */
export function summarise(ds: Dataset) {
  const perProblem: Record<string, number> = {};
  for (const l of ds.labels) {
    for (const c of l.expectedCheckIds)
      perProblem[c] = (perProblem[c] ?? 0) + 1;
  }
  const labelled = ds.labels.filter(
    (l) => l.expectedCheckIds.length > 0,
  ).length;
  return {
    tables: {
      clients: ds.clients.length,
      debtors: ds.debtors.length,
      ledger_entries: ds.ledgerEntries.length,
      ledger_status_events: ds.ledgerStatusEvents.length,
      credit_notes: ds.creditNotes.length,
      bank_transactions: ds.bankTransactions.length,
      receipt_allocations: ds.receiptAllocations.length,
      debtor_payments: ds.debtorPayments.length,
      batches: ds.batches.length,
      invoices: ds.invoices.length,
      fundings: ds.fundings.length,
      funding_adjustments: ds.fundingAdjustments.length,
      labels: ds.labels.length,
      watch_labels: ds.watchLabels.length,
    },
    labelledInvoices: labelled,
    labelledShare: labelled / ds.invoices.length,
    perProblem,
    cleanCases: ds.cleanCases,
    scriptedEvents: ds.scriptedEvents,
  };
}
