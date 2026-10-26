import { inArray } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

const INVALID = "Receipt allocation source is invalid or outside this client";

export function receiptCents(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(
      "Receipt amount must be nonnegative safe integer NZD cents",
    );
}

/** Validate the complete cash partition before consumers hide dated records. */
export async function validatedReceiptAllocations(
  db: Pick<Db, "select">,
  clientId: string,
  banks: (typeof t.bankTransactions.$inferSelect)[],
) {
  const bankById = new Map(banks.map((bank) => [bank.id, bank]));
  for (const bank of banks) {
    if (bank.clientId !== clientId) throw new Error(INVALID);
    receiptCents(bank.amountCents);
  }
  const allocations = banks.length
    ? await db
        .select()
        .from(t.receiptAllocations)
        .where(
          inArray(t.receiptAllocations.bankTransactionId, [...bankById.keys()]),
        )
    : [];
  const ids = [...new Set(allocations.map((row) => row.ledgerEntryId))];
  const ledgers = ids.length
    ? await db
        .select({
          id: t.ledgerEntries.id,
          clientId: t.ledgerEntries.clientId,
          debtorId: t.ledgerEntries.debtorId,
          issueDate: t.ledgerEntries.issueDate,
          recordedDate: t.ledgerEntries.recordedDate,
        })
        .from(t.ledgerEntries)
        .where(inArray(t.ledgerEntries.id, ids))
    : [];
  const debtorIds = [...new Set(ledgers.map((row) => row.debtorId))];
  const debtors = debtorIds.length
    ? await db
        .select({ id: t.debtors.id, clientId: t.debtors.clientId })
        .from(t.debtors)
        .where(inArray(t.debtors.id, debtorIds))
    : [];
  const debtorById = new Map(debtors.map((row) => [row.id, row]));
  const ledgerById = new Map(ledgers.map((row) => [row.id, row]));
  const totals = new Map<string, number>();
  for (const row of allocations) {
    const bank = bankById.get(row.bankTransactionId);
    if (!bank) throw new Error(INVALID);
    receiptCents(row.amountCents);
    const total = (totals.get(bank.id) ?? 0) + row.amountCents;
    receiptCents(total);
    if (total > bank.amountCents)
      throw new Error("Bank allocation exceeds available cash");
    totals.set(bank.id, total);
  }
  for (const row of allocations) {
    const ledger = ledgerById.get(row.ledgerEntryId);
    if (
      !ledger ||
      ledger.clientId !== clientId ||
      debtorById.get(ledger.debtorId)?.clientId !== clientId
    )
      throw new Error(INVALID);
  }
  return { allocations, ledgerById };
}
