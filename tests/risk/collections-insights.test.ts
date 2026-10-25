import { describe, expect, it } from "vitest";

import {
  collectionsInsights,
  type CollectionsReceivable,
} from "@/lib/risk/collections-insights";
import type { AgeingReceivable } from "@/lib/risk/debtor-ageing";

const rows: AgeingReceivable[] = [
  {
    invoiceId: "inv-1",
    debtorId: "d1",
    issuedDate: "2026-08-01",
    dueDate: "2026-08-31",
    faceCents: 10_000,
    receiptAllocations: [
      { sourceId: "bank-early", effectiveDate: "2026-09-10", cents: 3_000 },
      { sourceId: "bank-late", effectiveDate: "2026-10-15", cents: 2_000 },
      { sourceId: "bank-future", effectiveDate: "2026-11-01", cents: 5_000 },
    ],
    creditNotes: [
      { sourceId: "cn-1", effectiveDate: "2026-10-18", cents: 1_000 },
    ],
  },
  {
    invoiceId: "inv-2",
    debtorId: "d1",
    issuedDate: "2026-09-01",
    dueDate: "2026-10-01",
    faceCents: 5_000,
    receiptAllocations: [
      { sourceId: "bank-paid", effectiveDate: "2026-09-21", cents: 5_000 },
    ],
    creditNotes: [],
  },
  {
    invoiceId: "inv-3",
    debtorId: "d2",
    issuedDate: "2026-11-01",
    dueDate: "2026-11-30",
    faceCents: 2_000,
    receiptAllocations: [],
    creditNotes: [],
  },
];

describe("descriptive collections insights", () => {
  it("does not insert a newly learned backdated invoice into the prior-month balance", () => {
    const known: CollectionsReceivable = {
      ...rows[0]!,
      invoiceId: "known",
      recordedDate: "2026-08-01",
      receiptAllocations: [],
      creditNotes: [],
    };
    const late = {
      ...known,
      invoiceId: "late",
      recordedDate: "2026-10-20",
      faceCents: 9_000,
    };
    const future = {
      ...known,
      invoiceId: "future",
      recordedDate: "2026-10-25",
      faceCents: 6_000,
    };
    const inputs = [known, late, future];
    expect(collectionsInsights("2026-10-24", inputs)[0]).toMatchObject({
      overdueNowCents: 19_000,
      overdue30DaysAgoCents: 10_000,
      overdueMovement30DaysCents: 9_000,
    });
    expect(collectionsInsights("2026-10-19", inputs)[0]?.overdueNowCents).toBe(
      10_000,
    );
    expect(collectionsInsights("2026-10-25", inputs)[0]?.overdueNowCents).toBe(
      25_000,
    );
    expect(() =>
      collectionsInsights("2026-10-24", [
        { ...known, recordedDate: "2026-02-30" },
      ]),
    ).toThrow(/business date/);
  });
  it("replays the two 30-day windows without future leakage", () => {
    const [a] = collectionsInsights("2026-10-24", rows);
    expect(a).toMatchObject({
      debtorId: "d1",
      overdueNowCents: 4_000,
      overdue30DaysAgoCents: 7_000,
      overdueMovement30DaysCents: -3_000,
      receiptsLast30DaysCents: 2_000,
      receiptsPrevious30DaysCents: 8_000,
      creditsLast30DaysCents: 1_000,
      cashSettledInvoiceCount: 1,
      meanDaysToCashSettlement: 20,
      dsoDays: null,
    });
    expect(a?.signals.map((s) => s.code)).toEqual([
      "PAYMENTS_SLOWED",
      "RECENT_CREDIT",
    ]);
    expect(a?.signals[1]?.sourceIds).toEqual(["cn-1"]);
    expect(collectionsInsights("2026-10-24", rows)).toHaveLength(1);
  });

  it("does not count future credits or credit-only settlements as cash", () => {
    const [a] = collectionsInsights("2026-09-24", rows);
    expect(a?.creditsLast30DaysCents).toBe(0);
    expect(a?.cashSettledInvoiceCount).toBe(1);
    expect(a?.overdueNowCents).toBe(7_000);
    expect(a?.signals.map((s) => s.code)).toContain("ARREARS_INCREASE");
  });

  it("fails on impossible allocations and malformed dates", () => {
    expect(() => collectionsInsights("2026-02-30", rows)).toThrow();
    expect(() =>
      collectionsInsights("2026-10-24", [
        {
          ...rows[0]!,
          receiptAllocations: [
            {
              sourceId: "too-much",
              effectiveDate: "2026-09-01",
              cents: 20_000,
            },
          ],
        },
      ]),
    ).toThrow(/exceed/);
  });

  it("is order-independent and leaves unsupported DSO unavailable", () => {
    expect(collectionsInsights("2026-10-24", [...rows].reverse())).toEqual(
      collectionsInsights("2026-10-24", rows),
    );
    const empty = [
      { ...rows[0]!, debtorId: "new", receiptAllocations: [], creditNotes: [] },
    ];
    expect(collectionsInsights("2026-10-24", empty)[0]).toMatchObject({
      cashSettledInvoiceCount: 0,
      meanDaysToCashSettlement: null,
      dsoDays: null,
    });
  });
});
