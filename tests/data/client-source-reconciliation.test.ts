import { describe, expect, it } from "vitest";

import { createMemoryDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import {
  clientSourceReconciliation,
  nzBusinessDayEndUtc,
} from "@/lib/queries/client-source-reconciliation";
import { nzBusinessDateAt } from "@/lib/watch/as-of-events";

const day = "2026-10-20";
const cutoff = new Date("2026-10-20T12:30:00Z");

async function fixture() {
  const db = await createMemoryDb();
  await db.insert(t.clients).values([
    {
      id: "test-client",
      name: "Fictional lender client",
      industry: "services",
      facilityLimitCents: 100000,
      paymentTermsDays: 30,
    },
    {
      id: "foreign-client",
      name: "Another fictional client",
      industry: "retail",
      facilityLimitCents: 100000,
      paymentTermsDays: 30,
    },
  ]);
  await db.insert(t.debtors).values([
    {
      id: "debtor-1",
      clientId: "test-client",
      name: "Synthetic debtor one",
      nzbn: "9429000000001",
      firstSeenDate: "2026-01-01",
      creditBand: "A",
    },
    {
      id: "debtor-foreign",
      clientId: "foreign-client",
      name: "Synthetic debtor other",
      nzbn: "9429000000002",
      firstSeenDate: "2026-01-01",
      creditBand: "A",
    },
  ]);
  await db.insert(t.ledgerEntries).values([
    {
      id: "ledger-1",
      clientId: "test-client",
      debtorId: "debtor-1",
      invoiceNumber: "L-1",
      issueDate: "2026-10-01",
      recordedDate: "2026-10-01",
      amountCents: 10000,
    },
    {
      id: "ledger-2",
      clientId: "test-client",
      debtorId: "debtor-1",
      invoiceNumber: "L-2",
      issueDate: "2026-10-01",
      recordedDate: "2026-10-01",
      amountCents: 15000,
    },
    {
      id: "ledger-foreign",
      clientId: "foreign-client",
      debtorId: "debtor-foreign",
      invoiceNumber: "F-1",
      issueDate: "2026-10-01",
      recordedDate: "2026-10-01",
      amountCents: 10000,
    },
  ]);
  await db.insert(t.bankTransactions).values([
    {
      id: "bank-matched",
      clientId: "test-client",
      date: day,
      amountCents: 10000,
      counterpartyName: "Synthetic debtor one",
      reference: "match",
    },
    {
      id: "bank-partial",
      clientId: "test-client",
      date: day,
      amountCents: 8000,
      counterpartyName: "Synthetic debtor one",
      reference: "partial",
    },
    {
      id: "bank-unmatched",
      clientId: "test-client",
      date: day,
      amountCents: 5000,
      counterpartyName: "Unknown",
      reference: "no-allocation",
    },
    {
      id: "bank-future",
      clientId: "test-client",
      date: "2026-10-21",
      amountCents: 9000,
      counterpartyName: "Synthetic debtor one",
      reference: "future",
    },
    {
      id: "bank-foreign",
      clientId: "foreign-client",
      date: day,
      amountCents: 4000,
      counterpartyName: "Synthetic debtor other",
      reference: "foreign",
    },
  ]);
  await db.insert(t.receiptAllocations).values([
    {
      bankTransactionId: "bank-matched",
      ledgerEntryId: "ledger-1",
      amountCents: 10000,
    },
    {
      bankTransactionId: "bank-partial",
      ledgerEntryId: "ledger-2",
      amountCents: 3000,
    },
    {
      bankTransactionId: "bank-foreign",
      ledgerEntryId: "ledger-foreign",
      amountCents: 4000,
    },
  ]);
  await db.insert(t.creditNotes).values([
    {
      id: "credit-current",
      ledgerEntryId: "ledger-2",
      date: day,
      amountCents: 750,
    },
    {
      id: "credit-future",
      ledgerEntryId: "ledger-2",
      date: "2026-10-21",
      amountCents: 999,
    },
  ]);
  return db;
}

function checkStatus(
  result: NonNullable<Awaited<ReturnType<typeof clientSourceReconciliation>>>,
  kind: string,
) {
  return result.sourceHealth.find((row) => row.kind === kind)?.health;
}

describe("synthetic source-health and cash reconciliation (#160)", () => {
  it.each([
    ["2026-10-20", "2026-10-20T10:59:59.999Z"],
    ["2026-06-20", "2026-06-20T11:59:59.999Z"],
    ["2026-09-26", "2026-09-26T11:59:59.999Z"],
    ["2026-09-27", "2026-09-27T10:59:59.999Z"],
    ["2026-04-04", "2026-04-04T10:59:59.999Z"],
    ["2026-04-05", "2026-04-05T11:59:59.999Z"],
  ])(
    "ends NZ business day %s at its actual UTC boundary",
    (businessDay, expected) => {
      const end = nzBusinessDayEndUtc(businessDay);
      expect(end.toISOString()).toBe(expected);
      expect(nzBusinessDateAt(end)).toBe(businessDay);
      expect(nzBusinessDateAt(new Date(end.getTime() + 1))).not.toBe(
        businessDay,
      );
    },
  );

  it("excludes checkpoints and observations from the next NZ business day", async () => {
    const db = await fixture();
    const observedAt = new Date("2026-10-20T15:00:00Z");
    await db.insert(t.ingestionCheckpoints).values({
      sourceKind: "BANK",
      connectionId: "next-day",
      clientId: "test-client",
      lastSuccessAt: observedAt,
    });
    await db.insert(t.ingestionEvents).values({
      id: "next-nz-day",
      sourceKind: "BANK",
      connectionId: "next-day",
      clientId: "test-client",
      eventId: "next",
      entityId: "ledger-1",
      effectiveDate: day,
      observedAt,
      payload: {},
    });
    const report = await clientSourceReconciliation(
      db,
      "test-client",
      day,
      nzBusinessDayEndUtc(day),
    );
    expect(report!.acceptedObservationIds).toEqual([]);
    expect(checkStatus(report!, "BANK")).toBe("UNKNOWN");
    expect(() => nzBusinessDayEndUtc("2026-02-30")).toThrow(/business date/);
  });
  it.each([
    [2500, /outside this client/],
    [6000, /exceeds available cash/],
    [-1, /nonnegative safe integer/],
  ])(
    "rejects invalid foreign-ledger allocation of %s before filtering it away",
    async (amountCents, message) => {
      const db = await fixture();
      await db.insert(t.receiptAllocations).values({
        bankTransactionId: "bank-unmatched",
        ledgerEntryId: "ledger-foreign",
        amountCents,
      });
      await expect(
        clientSourceReconciliation(db, "test-client", day, cutoff),
      ).rejects.toThrow(message);
    },
  );
  it("reconciles bank rows exactly once and isolates client/date", async () => {
    const db = await fixture();
    const report = (await clientSourceReconciliation(
      db,
      "test-client",
      day,
      cutoff,
    ))!;
    expect(report.bankTotalCents).toBe(23000);
    expect(report.allocatedCents).toBe(13000);
    expect(report.unmatchedCents).toBe(10000);
    expect(report.matchedCount).toBe(1);
    expect(report.partialCount).toBe(1);
    expect(report.unmatchedCount).toBe(1);
    expect(report.creditNoteCents).toBe(750);
    expect(report.creditNoteIds).toEqual(["credit-current"]);
    expect(report.bankTransactions.map((row) => row.id)).not.toContain(
      "bank-future",
    );
    expect(report.bankTransactions.map((row) => row.id)).not.toContain(
      "bank-foreign",
    );
    expect(report.verifiedProviderSource).toBe(false);
    expect(checkStatus(report, "ACCOUNTING")).toBe("UNKNOWN");
    expect(checkStatus(report, "BANK")).toBe("UNKNOWN");
    const other = (await clientSourceReconciliation(
      db,
      "foreign-client",
      day,
      cutoff,
    ))!;
    expect(other.bankTotalCents).toBe(4000);
    expect(other.allocatedCents).toBe(4000);
    expect(
      await clientSourceReconciliation(db, "not-a-client", day, cutoff),
    ).toBeNull();
  }, 60_000);

  it("uses injected cutoff to label FRESH, STALE and ERROR without lookahead", async () => {
    const db = await fixture();
    await db.insert(t.ingestionCheckpoints).values([
      {
        sourceKind: "ACCOUNTING",
        connectionId: "synthetic-ledger",
        clientId: "test-client",
        lastSuccessAt: new Date("2026-10-20T12:15:00Z"),
        lastFailureAt: new Date("2026-10-20T13:30:00Z"),
      },
      {
        sourceKind: "BANK",
        connectionId: "synthetic-bank",
        clientId: "test-client",
        lastSuccessAt: new Date("2026-10-20T10:00:00Z"),
        lastFailureAt: new Date("2026-10-20T12:20:00Z"),
      },
    ]);
    await db.insert(t.ingestionEvents).values([
      {
        id: "before-cutoff",
        sourceKind: "ACCOUNTING",
        connectionId: "synthetic-ledger",
        clientId: "test-client",
        eventId: "evt-1",
        entityId: "ledger-1",
        effectiveDate: day,
        observedAt: new Date("2026-10-20T11:00:00Z"),
        payload: { synthetic: true },
      },
      {
        id: "future-observation",
        sourceKind: "ACCOUNTING",
        connectionId: "synthetic-ledger",
        clientId: "test-client",
        eventId: "evt-2",
        entityId: "ledger-2",
        effectiveDate: day,
        observedAt: new Date("2026-10-21T11:00:00Z"),
        payload: { synthetic: true },
      },
    ]);
    const report = (await clientSourceReconciliation(
      db,
      "test-client",
      day,
      cutoff,
      60,
    ))!;
    expect(checkStatus(report, "ACCOUNTING")).toBe("FRESH");
    expect(checkStatus(report, "BANK")).toBe("ERROR");
    expect(report.acceptedObservationIds).toEqual(["before-cutoff"]);
    const older = (await clientSourceReconciliation(
      db,
      "test-client",
      day,
      new Date("2026-10-20T11:00:00Z"),
      30,
    ))!;
    expect(checkStatus(older, "BANK")).toBe("STALE");
    expect(checkStatus(older, "ACCOUNTING")).toBe("UNKNOWN");
    expect(older.acceptedObservationIds).toEqual(["before-cutoff"]);
  }, 60_000);

  it("fails closed for cash over-allocation or malformed date/cutoff", async () => {
    const db = await fixture();
    await db.insert(t.receiptAllocations).values({
      bankTransactionId: "bank-unmatched",
      ledgerEntryId: "ledger-2",
      amountCents: 6000,
    });
    await expect(
      clientSourceReconciliation(db, "test-client", day, cutoff),
    ).rejects.toThrow(/exceeds available cash/);
    await expect(
      clientSourceReconciliation(db, "test-client", "2026-02-30", cutoff),
    ).rejects.toThrow(/business date/);
    await expect(
      clientSourceReconciliation(db, "test-client", day, new Date("invalid")),
    ).rejects.toThrow(/UTC cutoff/);
  }, 60_000);
});
