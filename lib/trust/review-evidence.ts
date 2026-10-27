import { eq, inArray } from "drizzle-orm";

import { validatedReceiptAllocations } from "@/lib/data/receipt-reconciliation";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

/** Raw records are bound before formatting, so changing a displayed fact changes the review. */
export async function loadReviewEvidence(
  db: Pick<Db, "select">,
  ids: string[],
  clientId: string,
) {
  const wanted = [...new Set(ids)].sort();
  const records: Record<string, Record<string, unknown>> = {};
  if (!wanted.length) return records;
  const add = (row: { id: string }, owner: string) => {
    if (owner !== clientId)
      throw Error("Review evidence crosses a client boundary");
    if (Object.hasOwn(records, row.id))
      throw Error("Ambiguous review evidence identity");
    records[row.id] = row as Record<string, unknown>;
  };
  const [
    clients,
    invoices,
    ledgers,
    notes,
    banks,
    payments,
    debtors,
    findings,
    fundings,
    adjustments,
    incidents,
  ] = await Promise.all([
    db.select().from(t.clients).where(inArray(t.clients.id, wanted)),
    db.select().from(t.invoices).where(inArray(t.invoices.id, wanted)),
    db
      .select()
      .from(t.ledgerEntries)
      .where(inArray(t.ledgerEntries.id, wanted)),
    db
      .select({ row: t.creditNotes, owner: t.ledgerEntries.clientId })
      .from(t.creditNotes)
      .innerJoin(
        t.ledgerEntries,
        eq(t.creditNotes.ledgerEntryId, t.ledgerEntries.id),
      )
      .where(inArray(t.creditNotes.id, wanted)),
    db
      .select()
      .from(t.bankTransactions)
      .where(inArray(t.bankTransactions.id, wanted)),
    db
      .select({ row: t.debtorPayments, owner: t.debtors.clientId })
      .from(t.debtorPayments)
      .innerJoin(t.debtors, eq(t.debtorPayments.debtorId, t.debtors.id))
      .where(inArray(t.debtorPayments.id, wanted)),
    db.select().from(t.debtors).where(inArray(t.debtors.id, wanted)),
    db
      .select({ row: t.findings, owner: t.invoices.clientId })
      .from(t.findings)
      .innerJoin(t.invoices, eq(t.findings.invoiceId, t.invoices.id))
      .where(inArray(t.findings.id, wanted)),
    db
      .select({ row: t.fundings, owner: t.invoices.clientId })
      .from(t.fundings)
      .innerJoin(t.invoices, eq(t.fundings.invoiceId, t.invoices.id))
      .where(inArray(t.fundings.id, wanted)),
    db
      .select({ row: t.fundingAdjustments, owner: t.invoices.clientId })
      .from(t.fundingAdjustments)
      .innerJoin(t.fundings, eq(t.fundingAdjustments.fundingId, t.fundings.id))
      .innerJoin(t.invoices, eq(t.fundings.invoiceId, t.invoices.id))
      .where(inArray(t.fundingAdjustments.id, wanted)),
    db.select().from(t.incidents).where(inArray(t.incidents.id, wanted)),
  ]);
  for (const row of clients) add(row, row.id);
  for (const row of [
    ...invoices,
    ...ledgers,
    ...banks,
    ...debtors,
    ...incidents,
  ])
    add(row, row.clientId);
  for (const { row, owner } of [
    ...notes,
    ...payments,
    ...findings,
    ...fundings,
    ...adjustments,
  ])
    add(row, owner);
  if (wanted.some((id) => !Object.hasOwn(records, id)))
    throw Error("Review evidence is unavailable");
  if (banks.length) {
    const { allocations } = await validatedReceiptAllocations(
      db,
      clientId,
      banks,
    );
    // Keep allocation rows separate, rather than giving an unscoped child record an owner.
    for (const bank of banks)
      records[bank.id] = {
        ...records[bank.id],
        allocations: allocations
          .filter((a) => a.bankTransactionId === bank.id)
          .sort((a, b) => a.ledgerEntryId.localeCompare(b.ledgerEntryId)),
      };
  }
  return records;
}

/** Stable subset used by a particular finding or explanation. */
export function evidenceSubset(
  records: Awaited<ReturnType<typeof loadReviewEvidence>>,
  ids: string[],
) {
  return Object.fromEntries(
    [...new Set(ids)]
      .sort()
      .filter((id) => Object.hasOwn(records, id))
      .map((id) => [id, records[id]]),
  );
}
