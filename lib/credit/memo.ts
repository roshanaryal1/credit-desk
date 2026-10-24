import { money } from "@/lib/format";

/** A credit memo is a HUMAN-REVIEWED document, never an automated approval. */
export type FinancialFact =
  | "REQUESTED_LIMIT"
  | "COMMITTED_LIMIT"
  | "OUTSTANDING_ADVANCES"
  | "ELIGIBLE_RECEIVABLES"
  | "SECURED_ADVANCE_VALUE";

export interface CreditEvidence {
  id: string;
  clientId: string;
  asOfDate: string;
  fact: FinancialFact;
  cents: number;
  sourceId: string;
  sourceLabel: string;
}

export interface MemoSection {
  title: string;
  statements: { text: string; evidenceIds: string[] }[];
}

export interface CreditMemoDraft {
  clientId: string;
  asOfDate: string;
  version: "synthetic-draft-1";
  status: "DRAFT_REVIEW_REQUIRED";
  title: string;
  sections: MemoSection[];
  evidenceIndex: CreditEvidence[];
  missingItems: string[];
  signedOffBy: null;
}

const REQUIREMENTS: FinancialFact[] = [
  "REQUESTED_LIMIT",
  "COMMITTED_LIMIT",
  "OUTSTANDING_ADVANCES",
  "ELIGIBLE_RECEIVABLES",
  "SECURED_ADVANCE_VALUE",
];

const LABELS: Record<FinancialFact, string> = {
  REQUESTED_LIMIT: "Requested facility amount",
  COMMITTED_LIMIT: "Existing commitment",
  OUTSTANDING_ADVANCES: "Outstanding funded advances",
  ELIGIBLE_RECEIVABLES: "Eligible receivables",
  SECURED_ADVANCE_VALUE: "Secured collateral advance value",
};

function safeText(v: string): string {
  return v
    .replace(/[\r\n\t<>*\u0060\[\]{}]/g, " ")
    .trim()
    .slice(0, 160);
}

function businessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

/** Assemble only sourced numbers. No LLM is involved in finance calculations. */
export function assembleCreditMemo(
  clientId: string,
  clientName: string,
  asOfDate: string,
  evidence: CreditEvidence[],
): CreditMemoDraft {
  if (!clientId.trim() || !clientName.trim() || !businessDate(asOfDate))
    throw new Error("Client and valid business date are required");
  const known = new Map<FinancialFact, CreditEvidence>();
  const ids = new Set<string>();
  for (const fact of evidence) {
    if (fact.clientId !== clientId)
      throw new Error("Cross-client evidence is not allowed");
    if (!fact.id.trim() || !fact.sourceId.trim() || !fact.sourceLabel.trim())
      throw new Error("Evidence provenance is missing");
    if (!businessDate(fact.asOfDate) || fact.asOfDate > asOfDate)
      throw new Error("Future or malformed evidence is not allowed");
    if (!Number.isSafeInteger(fact.cents) || fact.cents < 0)
      throw new Error("Unsupported monetary value");
    if (ids.has(fact.id) || known.has(fact.fact))
      throw new Error(
        "Duplicate evidence identity or unsupported fact version",
      );
    if (!(fact.fact in LABELS)) throw new Error("Unrecognized financial fact");
    ids.add(fact.id);
    known.set(fact.fact, fact);
  }
  const statements: MemoSection["statements"] = [];
  const missingItems: string[] = [];
  for (const requirement of REQUIREMENTS) {
    const datum = known.get(requirement);
    if (datum) {
      statements.push({
        text: `${LABELS[requirement]}: ${money(datum.cents)} (source: ${safeText(datum.sourceLabel)})`,
        evidenceIds: [datum.id],
      });
    } else {
      missingItems.push(`${LABELS[requirement]} — verified evidence required`);
    }
  }
  missingItems.push(
    "Debtor concentration and ageing — analyst verification required",
    "Key risks, mitigants and conditions — analyst verification required",
    "Independent credit decision and checker sign-off required",
  );
  return {
    clientId,
    asOfDate,
    version: "synthetic-draft-1",
    status: "DRAFT_REVIEW_REQUIRED",
    title: `Credit assessment — ${safeText(clientName)}`,
    sections: [
      { title: "Requested facility and financial position", statements },
      {
        title: "Risk assessment",
        statements: [
          {
            text: "No automated approval. Review each exception, data gap, debtor exposure and source freshness before a recommendation.",
            evidenceIds: [],
          },
        ],
      },
      {
        title: "Decision",
        statements: [
          {
            text: "Pending independent analyst assessment and authorized checker review. No funds may be disbursed from this draft.",
            evidenceIds: [],
          },
        ],
      },
    ],
    evidenceIndex: REQUIREMENTS.flatMap((key) => {
      const datum = known.get(key);
      return datum ? [datum] : [];
    }),
    missingItems,
    signedOffBy: null,
  };
}
