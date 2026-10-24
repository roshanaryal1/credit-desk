import type { CreditMemoDraft } from "./memo";

/** This export is an evidence register for a synthetic draft, not approval. */
function safeMarkdown(value: string): string {
  return value
    .replace(/[\r\n\t]/g, " ")
    .replace(/[<>`\\[\]#*_{}|]/g, "\\$&")
    .trim()
    .slice(0, 500);
}

export function renderSyntheticMemoMarkdown(memo: CreditMemoDraft): string {
  if (memo.status !== "DRAFT_REVIEW_REQUIRED" || memo.signedOffBy !== null) {
    throw new Error("Only unsigned review-required drafts may be exported");
  }
  const citations = new Set(memo.evidenceIndex.map((e) => e.id));
  if (citations.size !== memo.evidenceIndex.length) {
    throw new Error("Duplicate evidence reference");
  }
  for (const entry of memo.evidenceIndex) {
    if (entry.clientId !== memo.clientId || entry.asOfDate > memo.asOfDate ||
        !Number.isSafeInteger(entry.cents) || entry.cents < 0) {
      throw new Error("Invalid export evidence boundary");
    }
  }
  for (const section of memo.sections) {
    for (const statement of section.statements) {
      if (statement.evidenceIds.some((id) => !citations.has(id))) {
        throw new Error("Unverified export citation");
      }
    }
  }

  const lines = [
    "# DRAFT — ANALYST REVIEW REQUIRED",
    "",
    "**SYNTHETIC DATA ONLY — NOT A CREDIT APPROVAL OR FUNDING AUTHORITY**",
    "",
    "Document: " + safeMarkdown(memo.title),
    "Client reference: " + safeMarkdown(memo.clientId),
    "Business date: " + memo.asOfDate,
    "Version: " + memo.version,
    "Signed off by: NONE",
  ];
  for (const [index, section] of memo.sections.entries()) {
    lines.push("", "## " + (index + 1) + ". " + safeMarkdown(section.title), "");
    for (const statement of section.statements) {
      const suffix = statement.evidenceIds.length
        ? " [Sources: " + statement.evidenceIds.map(safeMarkdown).join(", ") + "]"
        : "";
      lines.push("- " + safeMarkdown(statement.text) + suffix);
    }
  }
  lines.push("", "## Evidence register", "");
  for (const evidence of memo.evidenceIndex) {
    lines.push(
      "- " + safeMarkdown(evidence.id) + " | " + safeMarkdown(evidence.fact) +
      " | " + safeMarkdown(evidence.sourceLabel) + " | Source " +
      safeMarkdown(evidence.sourceId) + " | As of " + evidence.asOfDate +
      " | NZD cents " + evidence.cents,
    );
  }
  lines.push("", "## Missing evidence — mandatory reviewer checks", "");
  for (const item of memo.missingItems) lines.push("- " + safeMarkdown(item));
  lines.push(
    "",
    "No AI or human approval is recorded by this export.",
    "Any lending recommendation, maker-checker approval and release of funds",
    "require separate verified identities, approved lender policy and evidence.",
    "",
  );
  return lines.join("\n");
}
