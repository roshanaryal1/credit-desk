import { describe, expect, it } from "vitest";

import { createMemoryDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { getClientReceivablesAgeing } from "@/lib/queries/client-ageing";

async function example() {
  const db = await createMemoryDb();
  await db.insert(t.clients).values([
    {
      id: "c1",
      name: "Synthetic Harbour",
      industry: "services",
      advanceRateBps: 7500,
      facilityLimitCents: 200_000,
      paymentTermsDays: 30,
    },
    {
      id: "c2",
      name: "Other Synthetic Firm",
      industry: "retail",
      advanceRateBps: 8000,
      facilityLimitCents: 500_000,
      paymentTermsDays: 30,
    },
  ]);
  await db.insert(t.debtors).values([
    {
      id: "d1",
      clientId: "c1",
      name: "Debtor One",
      nzbn: "9429000000001",
      firstSeenDate: "2026-01-01",
      creditBand: "B",
    },
    {
      id: "d2",
      clientId: "c2",
      name: "Other Debtor",
      nzbn: "9429000000002",
      firstSeenDate: "2026-01-01",
      creditBand: "A",
    },
  ]);
  await db.insert(t.ledgerEntries).values([
    {
      id: "l1",
      clientId: "c1",
      invoiceNumber: "INV-001",
      debtorId: "d1",
      amountCents: 20_000,
      issueDate: "2026-08-01",
      recordedDate: "2026-08-01",
    },
    {
      id: "l2",
      clientId: "c2",
      invoiceNumber: "INV-002",
      debtorId: "d2",
      amountCents: 90_000,
      issueDate: "2026-08-01",
      recordedDate: "2026-08-01",
    },
  ]);
  await db.insert(t.bankTransactions).values([
    {
      id: "b1",
      clientId: "c1",
      date: "2026-10-20",
      amountCents: 5_000,
      counterpartyName: "Debtor One",
      reference: "INV-001",
    },
    {
      id: "b2",
      clientId: "c1",
      date: "2026-11-01",
      amountCents: 3_000,
      counterpartyName: "Debtor One",
      reference: "INV-001",
    },
  ]);
  await db.insert(t.receiptAllocations).values([
    { bankTransactionId: "b1", ledgerEntryId: "l1", amountCents: 5_000 },
    { bankTransactionId: "b2", ledgerEntryId: "l1", amountCents: 3_000 },
  ]);
  await db.insert(t.creditNotes).values([
    {
      id: "cn1",
      ledgerEntryId: "l1",
      date: "2026-10-23",
      amountCents: 2_000,
    },
  ]);
  return db;
}

describe("synthetic client debtor ageing read model", () => {
  it("reconciles dated receipts and credits, with invoice traceability", async () => {
    const db = await example();
    const result = await getClientReceivablesAgeing(db, "c1", "2026-10-24");
    expect(result?.totalOutstandingCents).toBe(13_000);
    expect(result?.overdueCents).toBe(13_000);
    expect(result?.currentCents).toBe(0);
    expect(result?.debtors).toHaveLength(1);
    expect(result?.debtors[0]).toMatchObject({
      debtorName: "Debtor One",
      grossOutstandingCents: 13_000,
      paymentsLast30DaysCents: 5_000,
    });
    expect(result?.debtors[0]?.buckets.DAYS_31_60).toBe(13_000);
    expect(result?.collections[0]).toMatchObject({
      debtorId: "d1",
      receiptsLast30DaysCents: 5_000,
      creditsLast30DaysCents: 2_000,
      overdueMovement30DaysCents: -7_000,
      meanDaysToCashSettlement: null,
      dsoDays: null,
    });
    expect(result?.debtors[0]?.invoices[0]).toMatchObject({
      invoiceId: "l1",
      countedReceiptCents: 5_000,
      countedCreditCents: 2_000,
    });
  });

  it("moves the same receivable to its later age and applies future receipts", async () => {
    const db = await example();
    const later = await getClientReceivablesAgeing(db, "c1", "2026-11-05");
    expect(later?.totalOutstandingCents).toBe(10_000);
    expect(later?.debtors[0]?.buckets.DAYS_61_90).toBe(10_000);
    expect(later?.debtors[0]?.paymentsLast30DaysCents).toBe(8_000);
  });

  it("prevents cross-client leakage and refuses bad as-of dates", async () => {
    const db = await example();
    const other = await getClientReceivablesAgeing(db, "c2", "2026-10-24");
    expect(other?.debtors.map((d) => d.debtorName)).toEqual(["Other Debtor"]);
    expect(other?.totalOutstandingCents).toBe(90_000);
    expect(
      await getClientReceivablesAgeing(db, "not-real", "2026-10-24"),
    ).toBeNull();
    await expect(
      getClientReceivablesAgeing(db, "c1", "2026-09-31"),
    ).rejects.toThrow(/business date/);
  });
});
