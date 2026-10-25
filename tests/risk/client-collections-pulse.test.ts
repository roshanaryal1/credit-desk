import { describe, expect, it } from "vitest";

import { createMemoryDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { getClientReceivablesAgeing } from "@/lib/queries/client-ageing";
import { collectionsRiskSummary } from "@/lib/risk/client-collections-pulse";

async function source() {
  const db = await createMemoryDb();
  await db.insert(t.clients).values([
    {
      id: "client-a",
      name: "Synthetic Harbour",
      industry: "logistics",
      facilityLimitCents: 1_000_000,
      paymentTermsDays: 30,
    },
    {
      id: "client-b",
      name: "Unrelated Synthetic Borrower",
      industry: "logistics",
      facilityLimitCents: 1_000_000,
      paymentTermsDays: 30,
    },
  ]);
  await db.insert(t.debtors).values([
    {
      id: "debtor-a1",
      clientId: "client-a",
      name: "First buyer",
      nzbn: "9429000000001",
      firstSeenDate: "2026-01-01",
      creditBand: "B",
    },
    {
      id: "debtor-a2",
      clientId: "client-a",
      name: "Second buyer",
      nzbn: "9429000000002",
      firstSeenDate: "2026-01-01",
      creditBand: "B",
    },
    {
      id: "debtor-b",
      clientId: "client-b",
      name: "Other buyer",
      nzbn: "9429000000003",
      firstSeenDate: "2026-01-01",
      creditBand: "A",
    },
  ]);
  await db.insert(t.ledgerEntries).values([
    {
      id: "ledger-a1",
      clientId: "client-a",
      debtorId: "debtor-a1",
      invoiceNumber: "A-1",
      amountCents: 10_000,
      issueDate: "2026-08-01",
      recordedDate: "2026-08-01",
    },
    {
      id: "ledger-a2",
      clientId: "client-a",
      debtorId: "debtor-a2",
      invoiceNumber: "A-2",
      amountCents: 5_000,
      issueDate: "2026-09-01",
      recordedDate: "2026-09-01",
    },
    {
      id: "ledger-a3",
      clientId: "client-a",
      debtorId: "debtor-a1",
      invoiceNumber: "A-3",
      amountCents: 3_000,
      issueDate: "2026-10-01",
      recordedDate: "2026-10-01",
    },
    {
      id: "ledger-other",
      clientId: "client-b",
      debtorId: "debtor-b",
      invoiceNumber: "B-1",
      amountCents: 100_000,
      issueDate: "2026-08-01",
      recordedDate: "2026-08-01",
    },
  ]);
  await db.insert(t.bankTransactions).values({
    id: "bank-a1",
    clientId: "client-a",
    date: "2026-10-10",
    amountCents: 2_000,
    counterpartyName: "First buyer",
    reference: "A-1",
  });
  await db.insert(t.receiptAllocations).values({
    bankTransactionId: "bank-a1",
    ledgerEntryId: "ledger-a1",
    amountCents: 2_000,
  });
  await db.insert(t.creditNotes).values({
    id: "credit-a1",
    ledgerEntryId: "ledger-a1",
    date: "2026-10-15",
    amountCents: 1_000,
  });
  return db;
}

describe("client collections pulse (#104)", () => {
  it("reconciles a hand-calculated debtor and cash summary with stable source IDs", async () => {
    const db = await source();
    const r = (await getClientReceivablesAgeing(
      db,
      "client-a",
      "2026-10-20",
    ))!;
    const pulse = collectionsRiskSummary(r);
    expect(pulse).toMatchObject({
      clientId: "client-a",
      status: "DESCRIPTIVE_ONLY",
      overdueNowCents: 12_000,
      overduePrevious30DaysCents: 10_000,
      overdueMovementCents: 2_000,
      receiptsLast30DaysCents: 2_000,
      creditsLast30DaysCents: 1_000,
      dsoDays: null,
    });
    expect(pulse.largestDebtor).toMatchObject({
      id: "debtor-a1",
      outstandingCents: 10_000,
      shareBps: 6666,
      ledgerInvoiceIds: ["ledger-a1", "ledger-a3"],
    });
    expect(pulse.observations.every((o) =>
      ["debtor-a1", "debtor-a2"].includes(o.debtorId),
    )).toBe(true);
    expect(pulse.observations.some((o) =>
      o.sourceIds.includes("credit:credit-a1"),
    )).toBe(true);
    expect(pulse.largestDebtor?.ledgerInvoiceIds).not.toContain(
      "ledger-other",
    );
    expect(collectionsRiskSummary(r)).toEqual(pulse);
  }, 90_000);

  it("does not leak future receipts, notes, or another client's ledger", async () => {
    const db = await source();
    const earlier = (await getClientReceivablesAgeing(
      db,
      "client-a",
      "2026-09-20",
    ))!;
    const pulse = collectionsRiskSummary(earlier);
    expect(pulse.overdueNowCents).toBe(10_000);
    expect(pulse.creditsLast30DaysCents).toBe(0);
    expect(pulse.receiptsLast30DaysCents).toBe(0);
    expect(pulse.largestDebtor?.ledgerInvoiceIds).not.toContain("ledger-a3");
    const other = (await getClientReceivablesAgeing(
      db,
      "client-b",
      "2026-10-20",
    ))!;
    expect(collectionsRiskSummary(other).largestDebtor?.outstandingCents)
      .toBe(100_000);
    expect(collectionsRiskSummary(other).clientId).toBe("client-b");
  }, 90_000);

  it("distinguishes an unpopulated ledger from verified zero and fails invalid totals", async () => {
    const db = await createMemoryDb();
    await db.insert(t.clients).values({
      id: "empty",
      name: "No Dated Ledger",
      industry: "retail",
      facilityLimitCents: 50_000,
      paymentTermsDays: 30,
    });
    const empty = (await getClientReceivablesAgeing(
      db,
      "empty",
      "2026-10-20",
    ))!;
    expect(collectionsRiskSummary(empty)).toMatchObject({
      status: "INSUFFICIENT_SOURCE_RECORDS",
      overdueNowCents: null,
      largestDebtor: null,
    });
    const seeded = await source();
    const r = (await getClientReceivablesAgeing(
      seeded,
      "client-a",
      "2026-10-20",
    ))!;
    expect(() => collectionsRiskSummary({
      ...r,
      overdueCents: r.overdueCents + 1,
    })).toThrow(/reconcile/);
    expect(() => collectionsRiskSummary({
      ...r,
      collections: r.collections.slice(0, 1),
    })).toThrow(/Missing or duplicated/);
    expect(() => collectionsRiskSummary({
      ...r,
      collections: r.collections.map((x) => ({
        ...x,
        overdue30DaysAgoCents: Number.MAX_SAFE_INTEGER,
      })),
    })).toThrow();
  }, 90_000);
});
