import { describe, expect, it } from "vitest";

import { debtorAgeing, type AgeingReceivable } from "@/lib/risk/debtor-ageing";

const rows: AgeingReceivable[] = [
  {
    invoiceId: "a-1",
    debtorId: "debtor-a",
    issuedDate: "2026-08-01",
    dueDate: "2026-09-23",
    faceCents: 10_000,
    receiptAllocations: [
      { sourceId: "receipt-1", effectiveDate: "2026-10-10", cents: 2_000 },
      { sourceId: "receipt-2", effectiveDate: "2026-09-20", cents: 1_000 },
      { sourceId: "receipt-future", effectiveDate: "2026-11-01", cents: 500 },
    ],
    creditNotes: [
      { sourceId: "credit-1", effectiveDate: "2026-10-20", cents: 500 },
    ],
  },
  {
    invoiceId: "a-2",
    debtorId: "debtor-a",
    issuedDate: "2026-10-01",
    dueDate: "2026-11-01",
    faceCents: 5_000,
    receiptAllocations: [],
    creditNotes: [],
  },
  {
    invoiceId: "b-1",
    debtorId: "debtor-b",
    issuedDate: "2026-06-01",
    dueDate: "2026-07-20",
    faceCents: 20_000,
    receiptAllocations: [],
    creditNotes: [],
  },
];

describe("debtor as-of ageing and collections", () => {
  it("reconciles partial receipts, credit notes and ageing buckets", () => {
    const result = debtorAgeing("2026-10-24", rows);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      debtorId: "debtor-a",
      grossOutstandingCents: 11_500,
      overdueCents: 6_500,
      paymentsLast30DaysCents: 2_000,
      paymentsPrevious30DaysCents: 1_000,
    });
    expect(result[0]?.buckets).toMatchObject({
      CURRENT: 5_000,
      DAYS_31_60: 6_500,
    });
    expect(result[1]?.buckets.DAYS_90_PLUS).toBe(20_000);
    expect(result[0]?.invoices[0]).toMatchObject({
      invoiceId: "a-1",
      outstandingCents: 6_500,
      countedReceiptCents: 3_000,
      countedCreditCents: 500,
    });
  });

  it("ignores invoices and events not effective as of the requested date", () => {
    const result = debtorAgeing("2026-08-15", rows);
    expect(result).toHaveLength(2);
    expect(result[0]?.grossOutstandingCents).toBe(10_000);
    expect(result[0]?.buckets.CURRENT).toBe(10_000);
    expect(result[0]?.paymentsLast30DaysCents).toBe(0);
  });

  it("is order-independent and leaves source rows unmodified", () => {
    const a = debtorAgeing("2026-10-24", rows);
    expect(debtorAgeing("2026-10-24", [...rows].reverse())).toEqual(a);
    expect(rows[0]?.receiptAllocations).toHaveLength(3);
  });

  it("handles due-today, day 30, day 60 and day 90 boundaries", () => {
    const base = {
      ...rows[1]!,
      issuedDate: "2026-01-01",
      receiptAllocations: [],
      creditNotes: [],
    };
    const boundary = [
      { ...base, invoiceId: "day-0", dueDate: "2026-10-24" },
      { ...base, invoiceId: "day-30", dueDate: "2026-09-24" },
      { ...base, invoiceId: "day-60", dueDate: "2026-08-25" },
      { ...base, invoiceId: "day-90", dueDate: "2026-07-26" },
      { ...base, invoiceId: "day-91", dueDate: "2026-07-25" },
    ];
    const aged = debtorAgeing("2026-10-24", boundary)[0]!;
    expect(aged.buckets).toEqual({
      CURRENT: 5_000,
      DAYS_1_30: 5_000,
      DAYS_31_60: 5_000,
      DAYS_61_90: 5_000,
      DAYS_90_PLUS: 5_000,
    });
  });

  it("refuses malformed business dates, duplication and impossible allocations", () => {
    expect(() => debtorAgeing("2026-09-31", rows)).toThrow(/business date/);
    expect(() => debtorAgeing("2026-10-24", [rows[0]!, rows[0]!])).toThrow(
      /Duplicate invoice/,
    );
    expect(() =>
      debtorAgeing("2026-10-24", [
        {
          ...rows[0]!,
          receiptAllocations: [
            { sourceId: "x", effectiveDate: "2026-10-01", cents: 11_000 },
          ],
          creditNotes: [],
        },
      ]),
    ).toThrow(/exceed/);
    expect(() =>
      debtorAgeing("2026-10-24", [
        {
          ...rows[0]!,
          receiptAllocations: [
            { sourceId: "reused", effectiveDate: "2026-10-01", cents: 1_000 },
            { sourceId: "reused", effectiveDate: "2026-10-02", cents: 1_000 },
          ],
          creditNotes: [],
        },
      ]),
    ).toThrow(/Repeated/);
  });
});
