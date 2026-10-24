import { describe, expect, it } from "vitest";
import { demonstrationWorksheet } from "@/lib/credit/demo-worksheet";

describe("illustrative borrowing-base worksheet", () => {
  it("reconciles the baseline and low-utilisation scenario against the same collateral", () => {
    const high=demonstrationWorksheet("baseline");
    const low=demonstrationWorksheet("low-draw");
    expect(high.eligibleCollateralCents).toBe(28000);
    expect(low.eligibleCollateralCents).toBe(high.eligibleCollateralCents);
    expect(high.availableCents).toBe(0);
    expect(high.overdrawnCents).toBe(15000);
    expect(low.availableCents).toBe(18000);
    expect(low.treatments).toEqual(high.treatments);
    expect(high.treatments.map(x=>x.invoiceId)).toEqual(["INV-101","INV-102","INV-103","INV-104"]);
  });
});
