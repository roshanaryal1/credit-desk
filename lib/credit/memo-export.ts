import { assembleCreditMemo, type CreditMemoDraft } from "./memo";

/** This export is an evidence register for a synthetic draft, not approval. */
function safeMarkdown(value: string): string {
  return value
    .replace(/[\r\n\t]/g, " ")
    .replace(/[<>`\\[\]#*_{}|]/g, "\\$&")
    .trim()
    .slice(0, 500);
}

function safeSourceId(value: string): string {
  if (!/^[a-zA-Z0-9:._-]{1,160}$/.test(value)) {
    throw new Error("Invalid provenance identifier");
  }
  return value;
}

export function renderSyntheticMemoMarkdown(memo: CreditMemoDraft): string {
  if (memo.status !== "DRAFT_REVIEW_REQUIRED" || memo.signedOffBy !== null) {
    throw new Error("Only unsigned review-required drafts may be exported");
  }
  const citations = new Set(memo.evidenceIndex.map((e) => safeSourceId(e.id)));
  if (citations.size !== memo.evidenceIndex.length) {
    throw new Error("Duplicate evidence reference");
  }
  for (const entry of memo.evidenceIndex) {
    if (
      entry.clientId !== memo.clientId ||
      entry.asOfDate > memo.asOfDate ||
      !Number.isSafeInteger(entry.cents) ||
      entry.cents < 0
    ) {
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

  // This export supports the deterministic draft format only. A matching
  // citation ID does not substantiate arbitrary text or a changed amount.
  // Regenerate the permitted statements from evidence rather than trusting
  // caller-supplied narrative. Human edits need a separate revision workflow.
  const verified = assembleCreditMemo(
    memo.clientId,
    "Synthetic export verification",
    memo.asOfDate,
    memo.evidenceIndex,
  );
  if (
    memo.version !== verified.version ||
    memo.sections.length !== verified.sections.length ||
    memo.sections.some((section, index) => {
      const expected = verified.sections[index]!;
      return (
        section.title !== expected.title ||
        section.statements.length !== expected.statements.length ||
        section.statements.some((statement, statementIndex) => {
          const source = expected.statements[statementIndex]!;
          return (
            statement.text !== source.text ||
            statement.evidenceIds.length !== source.evidenceIds.length ||
            statement.evidenceIds.some(
              (id, citationIndex) => id !== source.evidenceIds[citationIndex],
            )
          );
        })
      );
    }) ||
    memo.missingItems.length !== verified.missingItems.length ||
    memo.missingItems.some(
      (item, index) => item !== verified.missingItems[index],
    )
  ) {
    throw new Error(
      "Unverified export statements; regenerate the draft from evidence",
    );
  }

  const lines = [
    "# DRAFT — ANALYST REVIEW REQUIRED",
    "",
    "**SYNTHETIC DATA ONLY — NOT A CREDIT APPROVAL OR FUNDING AUTHORITY**",
    "",
    "Document: " + safeMarkdown(memo.title),
    "Client reference: " + safeSourceId(memo.clientId),
    "Business date: " + memo.asOfDate,
    "Version: " + memo.version,
    "Signed off by: NONE",
  ];
  for (const [index, section] of memo.sections.entries()) {
    lines.push(
      "",
      "## " + (index + 1) + ". " + safeMarkdown(section.title),
      "",
    );
    for (const statement of section.statements) {
      const suffix = statement.evidenceIds.length
        ? " [Sources: " +
          statement.evidenceIds.map(safeSourceId).join(", ") +
          "]"
        : "";
      lines.push("- " + safeMarkdown(statement.text) + suffix);
    }
  }
  lines.push("", "## Evidence register", "");
  for (const evidence of memo.evidenceIndex) {
    lines.push(
      "- " +
        safeSourceId(evidence.id) +
        " | " +
        safeSourceId(evidence.fact) +
        " | " +
        safeMarkdown(evidence.sourceLabel) +
        " | Source " +
        safeSourceId(evidence.sourceId) +
        " | As of " +
        evidence.asOfDate +
        " | NZD cents " +
        evidence.cents,
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
