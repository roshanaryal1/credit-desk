import { describe, expect, it } from "vitest";
import { assembleCreditMemo, type CreditEvidence } from "@/lib/credit/memo";

const rows: CreditEvidence[] = [
  {
    id: "req1",
    clientId: "c1",
    asOfDate: "2026-10-24",
    fact: "REQUESTED_LIMIT",
    cents: 500000,
    sourceId: "application1",
    sourceLabel: "Application 1",
  },
  {
    id: "comm1",
    clientId: "c1",
    asOfDate: "2026-10-24",
    fact: "COMMITTED_LIMIT",
    cents: 400000,
    sourceId: "facility1",
    sourceLabel: "Facility terms",
  },
  {
    id: "out1",
    clientId: "c1",
    asOfDate: "2026-10-24",
    fact: "OUTSTANDING_ADVANCES",
    cents: 250000,
    sourceId: "funding1",
    sourceLabel: "Funding ledger",
  },
];

describe("evidence-bounded credit memo", () => {
  it("marks the document as draft, and cites every sourced financial amount", () => {
    const r = assembleCreditMemo("c1", "Example Trading", "2026-10-24", rows);
    expect(r.status).toBe("DRAFT_REVIEW_REQUIRED");
    expect(r.signedOffBy).toBeNull();
    expect(r.sections[0]?.statements).toHaveLength(3);
    expect(
      r.sections[0]?.statements.every((s) => s.evidenceIds.length === 1),
    ).toBe(true);
    expect(r.missingItems).toContain(
      "Eligible receivables — verified evidence required",
    );
    expect(r.evidenceIndex.map((x) => x.id)).toEqual(["req1", "comm1", "out1"]);
  });
  it("rejects crossed clients, future data, duplicates, bad provenance and invalid money", () => {
    expect(() =>
      assembleCreditMemo("c1", "Example", "2026-10-24", [
        { ...rows[0]!, clientId: "other" },
      ]),
    ).toThrow(/Cross-client/);
    expect(() =>
      assembleCreditMemo("c1", "Example", "2026-10-24", [
        { ...rows[0]!, asOfDate: "2026-10-25" },
      ]),
    ).toThrow(/Future/);
    expect(() =>
      assembleCreditMemo("c1", "Example", "2026-10-24", [rows[0]!, rows[0]!]),
    ).toThrow(/Duplicate/);
    expect(() =>
      assembleCreditMemo("c1", "Example", "2026-10-24", [
        { ...rows[0]!, sourceId: "" },
      ]),
    ).toThrow(/provenance/);
    expect(() =>
      assembleCreditMemo("c1", "Example", "2026-10-24", [
        { ...rows[0]!, cents: -2 },
      ]),
    ).toThrow(/monetary/);
  });
  it("sanitizes untrusted client/source display strings without losing evidence IDs", () => {
    const x = assembleCreditMemo(
      "c1",
      "Example\n# Misleading heading",
      "2026-10-24",
      [{ ...rows[0]!, sourceLabel: "Ledger\n# forged" }],
    );
    expect(x.title).not.toContain("\n");
    expect(x.sections[0]?.statements[0]?.text).not.toContain("\n");
    expect(x.sections[0]?.statements[0]?.evidenceIds).toEqual(["req1"]);
  });
});
