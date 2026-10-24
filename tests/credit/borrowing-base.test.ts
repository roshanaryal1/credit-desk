import { describe, expect, it } from "vitest";

import {
  borrowingBase,
  type BorrowingPolicy,
  type Receivable,
} from "@/lib/credit/borrowing-base";

const policy: BorrowingPolicy = {
  version: "demo-v2-pending-credit-signoff",
  advanceRateBps: 7500,
  maximumDebtorShareBps: 5000,
  facilityLimitCents: 50_000,
  drawnCents: 35_000,
  reservesCents: 1_000,
  sublimitCents: 40_000,
};

const invoices: Receivable[] = [
  {
    invoiceId: "A",
    debtorId: "alpha",
    faceCents: 10_000,
    receivedCents: 2_000,
    creditNoteCents: 0,
    ineligibleReasons: [],
  },
  {
    invoiceId: "B",
    debtorId: "alpha",
    faceCents: 5_000,
    receivedCents: 0,
    creditNoteCents: 1_000,
    ineligibleReasons: [],
  },
  {
    invoiceId: "C",
    debtorId: "beta",
    faceCents: 20_000,
    receivedCents: 0,
    creditNoteCents: 0,
    ineligibleReasons: [],
  },
  {
    invoiceId: "D",
    debtorId: "gamma",
    faceCents: 10_000,
    receivedCents: 0,
    creditNoteCents: 0,
    ineligibleReasons: ["DISPUTED"],
  },
];

describe("borrowing base (independent hand-calculated worksheet)", () => {
  it("traces the full waterfall without double-counting reductions", () => {
    // Face 45,000; paid/credits 3,000; net 42,000; exclude disputed 10,000;
    // eligible pre-cap 32,000; beta cap 16,000; eligible post-cap 28,000;
    // gross advance 6,000 + 3,000 + 12,000 = 21,000; reserves 1,000;
    // collateral-secured value 20,000; already drawn 35,000 => zero
    // remaining availability, despite 5,000 sublimit headroom.
    const r = borrowingBase("2026-10-24", policy, invoices);
    expect(r).toMatchObject({
      policyVersion: policy.version,
      grossReceivablesCents: 45_000,
      receiptsAndCreditsCents: 3_000,
      netReceivablesCents: 42_000,
      excludedCents: 10_000,
      concentrationExcessCents: 4_000,
      eligibleCollateralCents: 28_000,
      grossAdvanceCents: 21_000,
      securedAdvanceCents: 20_000,
      facilityHeadroomCents: 15_000,
      sublimitHeadroomCents: 5_000,
      availableCents: 0,
      overdrawnCents: 15_000,
    });
    expect(r.treatments.find((x) => x.invoiceId === "C")).toMatchObject({
      eligibleCents: 16_000,
      concentrationExcessCents: 4_000,
      advanceCents: 12_000,
      reasons: ["CONCENTRATION_CAP"],
    });
    expect(r.treatments.find((x) => x.invoiceId === "D")).toMatchObject({
      netCents: 10_000,
      eligibleCents: 0,
      excludedCents: 10_000,
      reasons: ["DISPUTED"],
    });
  });

  it("calculates available funding by limiting collateral, commitment and sublimit", () => {
    expect(
      borrowingBase("2026-10-24", { ...policy, drawnCents: 2_000 }, invoices)
        .availableCents,
    ).toBe(18_000);
    expect(
      borrowingBase(
        "2026-10-24",
        { ...policy, drawnCents: 2_000, sublimitCents: 12_000 },
        invoices,
      ).availableCents,
    ).toBe(10_000);
    expect(
      borrowingBase(
        "2026-10-24",
        { ...policy, drawnCents: 2_000, facilityLimitCents: 15_000 },
        invoices,
      ).availableCents,
    ).toBe(13_000);
  });

  it("is independent of source ordering and does not mutate callers' rows", () => {
    const a = borrowingBase("2026-10-24", policy, invoices);
    expect(
      borrowingBase("2026-10-24", policy, [...invoices].reverse()),
    ).toEqual(a);
    expect(invoices[2]?.ineligibleReasons).toEqual([]);
  });

  it("rounds advances per receivable, never on an aggregate", () => {
    const rows = [1, 2, 3].map((n) => ({
      invoiceId: String(n),
      debtorId: String(n),
      faceCents: 3_333,
      receivedCents: 0,
      creditNoteCents: 0,
      ineligibleReasons: [],
    }));
    const r = borrowingBase(
      "2026-10-24",
      {
        ...policy,
        maximumDebtorShareBps: 10_000,
        drawnCents: 0,
        reservesCents: 0,
        sublimitCents: undefined,
      },
      rows,
    );
    expect(r.grossAdvanceCents).toBe(7_497);
  });

  it("rejects duplicate submissions, missing eligibility, corrupt amounts and invalid policy", () => {
    expect(() =>
      borrowingBase("2026-10-24", policy, [invoices[0]!, invoices[0]!]),
    ).toThrow(/Duplicate invoice/);
    expect(() =>
      borrowingBase("2026-10-24", policy, [
        { ...invoices[0]!, ineligibleReasons: undefined! },
      ]),
    ).toThrow(/eligibility assessment/);
    expect(() =>
      borrowingBase("2026-10-24", policy, [
        { ...invoices[0]!, receivedCents: 10_001 },
      ]),
    ).toThrow(/exceed face/);
    expect(() => borrowingBase("2026-09-31", policy, invoices)).toThrow(
      /business date/,
    );
    expect(() =>
      borrowingBase(
        "2026-10-24",
        { ...policy, advanceRateBps: 10_001 },
        invoices,
      ),
    ).toThrow(/basis points/);
    expect(() =>
      borrowingBase("2026-10-24", { ...policy, drawnCents: -1 }, invoices),
    ).toThrow(/non-negative/);
  });

  it("handles zero collateral and completely reserved borrowing base", () => {
    const result = borrowingBase(
      "2026-10-24",
      {
        ...policy,
        drawnCents: 0,
        reservesCents: 99_999,
      },
      invoices,
    );
    expect(result.availableCents).toBe(0);
    expect(result.securedAdvanceCents).toBe(0);
    expect(borrowingBase("2026-10-24", policy, []).availableCents).toBe(0);
  });

  it("can calculate near safe-integer cents without multiplying beyond precision", () => {
    const safe = borrowingBase(
      "2026-10-24",
      {
        ...policy,
        maximumDebtorShareBps: 10_000,
        advanceRateBps: 8_000,
        facilityLimitCents: Number.MAX_SAFE_INTEGER,
        drawnCents: 0,
        reservesCents: 0,
        sublimitCents: undefined,
      },
      [
        {
          invoiceId: "big",
          debtorId: "large",
          faceCents: 9_000_000_000_000,
          receivedCents: 0,
          creditNoteCents: 0,
          ineligibleReasons: [],
        },
      ],
    );
    expect(safe.availableCents).toBe(7_200_000_000_000);
  });
});
