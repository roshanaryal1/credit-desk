import { describe, expect, it } from "vitest";

import { advanceCents, fundableCents } from "@/lib/queries/money";

describe("money rules (SPEC 4.3)", () => {
  it("floors the advance per invoice", () => {
    expect(advanceCents(12_345, 8000)).toBe(9876);
  });

  it("rounds per invoice, then sums", () => {
    // 3 x floor(3333 x 0.8) = 3 x 2666 = 7998, not floor(9999 x 0.8) = 7999
    expect(
      fundableCents({
        approvedAmountsCents: [3333, 3333, 3333],
        advanceRateBps: 8000,
        facilityLimitCents: 1e9,
        fundsInUseCents: 0,
      }).uncapped,
    ).toBe(7998);
  });

  it("caps at facility headroom and never goes negative", () => {
    const r = fundableCents({
      approvedAmountsCents: [100_000],
      advanceRateBps: 8000,
      facilityLimitCents: 50_000,
      fundsInUseCents: 60_000,
    });
    expect(r).toEqual({ uncapped: 80_000, capped: 0, headroom: 0 });
  });
});
