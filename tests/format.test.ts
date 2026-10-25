import { describe, expect, it } from "vitest";

import { money } from "@/lib/format";

describe("NZD money formatting", () => {
  it.each([
    [0, "$0.00"],
    [-0, "-$0.00"],
    [1, "$0.01"],
    [99, "$0.99"],
    [100, "$1.00"],
    [101, "$1.01"],
    [1_234_567, "$12,345.67"],
    [-1, "-$0.01"],
    [-99, "-$0.99"],
    [-100, "-$1.00"],
    [-1_234_567, "-$12,345.67"],
  ])("formats %s integer cents as %s", (cents, expected) => {
    expect(money(cents)).toBe(expected);
  });

  it.each([
    [9_007_199_254_740_991, "$90,071,992,547,409.91"],
    [9_007_199_254_740_990, "$90,071,992,547,409.90"],
    [9_007_199_254_740_989, "$90,071,992,547,409.89"],
    [9_007_199_254_740_901, "$90,071,992,547,409.01"],
    [-9_007_199_254_740_991, "-$90,071,992,547,409.91"],
    [-9_007_199_254_740_989, "-$90,071,992,547,409.89"],
    [-9_007_199_254_740_901, "-$90,071,992,547,409.01"],
  ])(
    "preserves the cents at the safe-integer boundary: %s",
    (cents, expected) => {
      expect(money(cents)).toBe(expected);
    },
  );

  it("preserves the existing Intl behavior for unsupported inputs", () => {
    const legacy = new Intl.NumberFormat("en-NZ", {
      style: "currency",
      currency: "NZD",
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 2,
    });
    for (const value of [
      12.5,
      -12.5,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(money(value)).toBe(legacy.format(value / 100));
    }
  });
});
