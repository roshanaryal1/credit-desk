import { describe, expect, it } from "vitest";

import { draftMemoFromSyntheticClient } from "@/lib/credit/memo-demo";
import { renderSyntheticMemoMarkdown } from "@/lib/credit/memo-export";

const sample = () =>
  draftMemoFromSyntheticClient({
    id: "cli_0001",
    name: "Fictional Borrower",
    facilityLimitCents: 120_000_00,
    fundsInUseCents: 42_000_00,
  });

describe("unsigned synthetic memo export", () => {
  it("includes all validated quantitative facts, provenance and missing evidence", () => {
    const memo = sample();
    const output = renderSyntheticMemoMarkdown(memo);
    expect(output).toContain("DRAFT — ANALYST REVIEW REQUIRED");
    expect(output).toContain("SYNTHETIC DATA ONLY");
    expect(output).toContain(memo.version);
    expect(output).toContain("Signed off by: NONE");
    for (const evidence of memo.evidenceIndex) {
      expect(output).toContain(evidence.id);
      expect(output).toContain(evidence.sourceId);
      expect(output).toContain(evidence.cents.toString());
    }
    for (const item of memo.missingItems) {
      expect(output).toContain(item);
    }
    expect(output).not.toMatch(/SIGNED OFF BY: (?!NONE)/i);
  });
  it("rejects cross-client evidence, future figures and unsupported citations", () => {
    const other = sample();
    other.evidenceIndex[0]!.clientId = "other-client";
    expect(() => renderSyntheticMemoMarkdown(other)).toThrow(
      /evidence boundary/,
    );
    const future = sample();
    future.evidenceIndex[0]!.asOfDate = "2099-01-01";
    expect(() => renderSyntheticMemoMarkdown(future)).toThrow(
      /evidence boundary/,
    );
    const citation = sample();
    citation.sections[0]!.statements[0]!.evidenceIds.push(
      "hallucinated-evidence",
    );
    expect(() => renderSyntheticMemoMarkdown(citation)).toThrow(/citation/);
  });
  it("escapes Markdown/HTML injection and remains unsigned", () => {
    const memo = sample();
    memo.title = "<script>alert(1)</script>\n# Export title";
    const output = renderSyntheticMemoMarkdown(memo);
    expect(output).not.toContain("<script>");
    expect(output).not.toContain("\n# Export title");
    expect(output).toContain("Signed off by: NONE");
  });

  it("rejects fabricated amounts even when they cite a real evidence ID", () => {
    const memo = sample();
    memo.sections[0]!.statements[0]!.text =
      "Existing commitment: $9,999,999.00";
    expect(() => renderSyntheticMemoMarkdown(memo)).toThrow(
      /Unverified export statements/,
    );
    const alteredEvidence = sample();
    alteredEvidence.evidenceIndex[0]!.cents += 1;
    expect(() => renderSyntheticMemoMarkdown(alteredEvidence)).toThrow(
      /Unverified export statements/,
    );
  });

  it("rejects uncited added narrative and removed mandatory gaps", () => {
    const narrative = sample();
    narrative.sections[1]!.statements.push({
      text: "Approved for unrestricted lending",
      evidenceIds: [],
    });
    expect(() => renderSyntheticMemoMarkdown(narrative)).toThrow(
      /Unverified export statements/,
    );
    const missing = sample();
    missing.missingItems.pop();
    expect(() => renderSyntheticMemoMarkdown(missing)).toThrow(
      /Unverified export statements/,
    );
  });
});
