import { describe, expect, it } from "vitest";

import { draftMemoFromSyntheticClient } from "@/lib/credit/memo-demo";

describe("synthetic credit memo preview", () => {
  const sample = {
    id: "c1",
    name: "Synthetic Trading Ltd",
    facilityLimitCents: 500_000,
    fundsInUseCents: 200_000,
  };
  it("cites the two available financial facts but never invents requested collateral", () => {
    const draft = draftMemoFromSyntheticClient(sample);
    expect(draft.status).toBe("DRAFT_REVIEW_REQUIRED");
    expect(draft.signedOffBy).toBeNull();
    expect(draft.evidenceIndex.map((r) => r.fact)).toEqual([
      "COMMITTED_LIMIT",
      "OUTSTANDING_ADVANCES",
    ]);
    expect(draft.sections[0]?.statements).toHaveLength(2);
    expect(draft.sections[0]?.statements.every((s) => s.evidenceIds.length === 1)).toBe(true);
    expect(draft.missingItems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Requested facility"),
        expect.stringContaining("Eligible receivables"),
        expect.stringContaining("Independent credit decision"),
      ]),
    );
    expect(draft.sections[2]?.statements[0]?.text).toMatch(/No funds may be disbursed/);
  });
  it("fails closed on unsafe numbers and never generates an unsigned fake approval", () => {
    expect(() => draftMemoFromSyntheticClient({
      ...sample,
      fundsInUseCents: Number.NaN,
    })).toThrow(/Unsupported monetary/);
  });
});
