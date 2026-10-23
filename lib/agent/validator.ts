import { AgentOutputSchema, type AgentOutput } from "./schema";
import type { EvidenceRegistry } from "./evidence";

// The citation validator (SPEC 8). The validator, not the provider, is the
// guarantee: an explanation is only stored as PASSED when every claim cites
// records returned in this run and every dollar amount and date it states
// appears in a record that claim cites. It cannot prove the reasoning is
// right; the UI says so.

export type ValidationResult =
  | { ok: true; value: AgentOutput }
  | { ok: false; errors: string[]; value?: AgentOutput };

const MONEY = /\$\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/g;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
// Wording the agent must never use: it does not approve or fund anything.
const FORBIDDEN =
  /\b(approved|has been funded|is funded|will be funded|we will fund)\b/i;

/** Dollar amounts in text, as integer cents. */
export function moneyMentions(text: string): number[] {
  return [...text.matchAll(MONEY)].map((m) => {
    const whole = Number((m[1] ?? "0").replace(/,/g, ""));
    const fraction = Number((m[2] ?? "0").padEnd(2, "0"));
    return whole * 100 + fraction;
  });
}

export function dateMentions(text: string): string[] {
  return [...text.matchAll(ISO_DATE)].map((m) => m[0]);
}

/** Every money value (as cents) and date string anywhere in a record. */
function recordFacts(
  value: unknown,
  keyHint = "",
): { cents: Set<number>; dates: Set<string> } {
  const cents = new Set<number>();
  const dates = new Set<string>();
  const visit = (v: unknown, key: string) => {
    if (typeof v === "number") {
      // Tool records state dollars; finding details use *Cents integers.
      if (/cents$/i.test(key)) cents.add(Math.round(v));
      else cents.add(Math.round(v * 100));
    } else if (typeof v === "string") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) dates.add(v);
    } else if (Array.isArray(v)) {
      v.forEach((x) => visit(x, key));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) visit(x, k);
    }
  };
  visit(value, keyHint);
  return { cents, dates };
}

/** Extracts the first JSON object from model text (handles code fences). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in output");
  return JSON.parse(text.slice(start, end + 1));
}

export function validateOutput(
  raw: string,
  evidence: EvidenceRegistry,
): ValidationResult {
  let json: unknown;
  try {
    json = extractJson(raw);
  } catch (err) {
    return {
      ok: false,
      errors: [`output is not valid JSON: ${(err as Error).message}`],
    };
  }
  const parsed = AgentOutputSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (i) => `schema: ${i.path.join(".") || "(root)"}: ${i.message}`,
      ),
    };
  }
  const out = parsed.data;
  const errors: string[] = [];

  const unknownIds = (ids: string[]) => ids.filter((id) => !evidence.has(id));
  for (const id of unknownIds(out.cited_evidence_ids)) {
    errors.push(`cited id ${id} was not returned by a tool in this run`);
  }

  out.claims.forEach((claim, i) => {
    const missing = unknownIds(claim.evidence_ids);
    for (const id of missing) {
      errors.push(
        `claim ${i + 1} cites ${id}, which was not returned by a tool in this run`,
      );
    }
    const cited = claim.evidence_ids
      .filter((id) => evidence.has(id))
      .map((id) => evidence.get(id));
    const facts = recordFacts(cited);
    for (const c of moneyMentions(claim.text)) {
      if (!facts.cents.has(c)) {
        errors.push(
          `claim ${i + 1} states $${(c / 100).toFixed(2)}, which is not in its cited records`,
        );
      }
    }
    for (const d of dateMentions(claim.text)) {
      if (!facts.dates.has(d)) {
        errors.push(
          `claim ${i + 1} states ${d}, which is not in its cited records`,
        );
      }
    }
  });

  const allCited = [
    ...new Set([
      ...out.cited_evidence_ids,
      ...out.claims.flatMap((c) => c.evidence_ids),
    ]),
  ]
    .filter((id) => evidence.has(id))
    .map((id) => evidence.get(id));
  const summaryFacts = recordFacts(allCited);
  for (const c of moneyMentions(out.summary)) {
    if (!summaryFacts.cents.has(c)) {
      errors.push(
        `summary states $${(c / 100).toFixed(2)}, which is not in any cited record`,
      );
    }
  }
  for (const d of dateMentions(out.summary)) {
    if (!summaryFacts.dates.has(d)) {
      errors.push(`summary states ${d}, which is not in any cited record`);
    }
  }

  const texts = [out.summary, ...out.claims.map((c) => c.text)];
  if (texts.some((s) => FORBIDDEN.test(s))) {
    errors.push(
      "output says something is approved or funded; the agent never approves or funds",
    );
  }

  return errors.length === 0
    ? { ok: true, value: out }
    : { ok: false, errors, value: out };
}
