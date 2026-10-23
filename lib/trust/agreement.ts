// Agreement between the agent and analysts (SPEC 9.1, 9.2, ADR 0005).
// Pure functions over decision records; the UI and tests share them.

export type Decision = "APPROVE" | "HOLD" | "REJECT";
export type Recommendation = Decision | "REQUEST_INFO";

export interface DecisionRecord {
  decisionId: string;
  invoiceId: string;
  decision: Decision;
  mode: "SHADOW" | "ASSIST";
  exposed: boolean;
  simulated: boolean;
  /** ISO instant. */
  decidedAt: string;
  /** Decisions on the same invoice before this one. */
  priorDecisions: number;
  recommendation: Recommendation | null;
  explanationPassed: boolean;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | null;
  checks: string[];
}

export type ExclusionReason =
  | "ASSIST_MODE"
  | "EXPOSED_BEFORE_DECISION"
  | "REVISION"
  | "NO_VALID_EXPLANATION";

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  ASSIST_MODE: "made in assist mode",
  EXPOSED_BEFORE_DECISION: "agent output seen before deciding",
  REVISION: "revision of an earlier decision",
  NO_VALID_EXPLANATION: "no validated explanation to compare",
};

/** REQUEST_INFO is treated as HOLD for agreement and kappa (C7). */
export const asDecision = (r: Recommendation): Decision =>
  r === "REQUEST_INFO" ? "HOLD" : r;

export function exclusionReason(d: DecisionRecord): ExclusionReason | null {
  if (d.mode !== "SHADOW") return "ASSIST_MODE";
  if (d.exposed) return "EXPOSED_BEFORE_DECISION";
  if (d.priorDecisions > 0) return "REVISION";
  if (!d.explanationPassed || d.recommendation === null)
    return "NO_VALID_EXPLANATION";
  return null;
}

export interface Rate {
  agree: number;
  n: number;
  rate: number | null;
  /** 95% Wilson score interval. */
  low: number | null;
  high: number | null;
}

export function wilson(agree: number, n: number, z = 1.96): Rate {
  if (n === 0) return { agree, n, rate: null, low: null, high: null };
  const p = agree / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const denom = 1 + z2 / n;
  return {
    agree,
    n,
    rate: p,
    low: Math.max(0, (centre - margin) / denom),
    high: Math.min(1, (centre + margin) / denom),
  };
}

const DECISIONS: Decision[] = ["APPROVE", "HOLD", "REJECT"];

/** Cohen's kappa over the three decision categories; null when undefined. */
export function cohensKappa(
  pairs: { agent: Decision; analyst: Decision }[],
): number | null {
  const n = pairs.length;
  if (n === 0) return null;
  const agree = pairs.filter((p) => p.agent === p.analyst).length / n;
  let expected = 0;
  for (const c of DECISIONS) {
    const a = pairs.filter((p) => p.agent === c).length / n;
    const b = pairs.filter((p) => p.analyst === c).length / n;
    expected += a * b;
  }
  if (expected === 1) return null;
  return (agree - expected) / (1 - expected);
}

/** ISO week start (Monday) for an instant, in NZ time. */
export function weekOf(isoInstant: string): string {
  const nz = new Date(
    new Date(isoInstant).toLocaleString("en-US", {
      timeZone: "Pacific/Auckland",
    }),
  );
  const day = (nz.getDay() + 6) % 7;
  nz.setDate(nz.getDate() - day);
  const y = nz.getFullYear();
  const m = String(nz.getMonth() + 1).padStart(2, "0");
  const d = String(nz.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface AgreementReport {
  eligible: number;
  excluded: Record<ExclusionReason, number>;
  overall: Rate;
  kappa: number | null;
  byCheck: Record<string, Rate>;
  byRisk: Record<string, Rate>;
  /** confusion[recommendation][decision] = count, keeping all four recommendations. */
  confusion: Record<Recommendation, Record<Decision, number>>;
  weekly: { week: string; rate: Rate }[];
  disagreements: DecisionRecord[];
}

export function agreementReport(records: DecisionRecord[]): AgreementReport {
  const excluded: Record<ExclusionReason, number> = {
    ASSIST_MODE: 0,
    EXPOSED_BEFORE_DECISION: 0,
    REVISION: 0,
    NO_VALID_EXPLANATION: 0,
  };
  const eligible: (DecisionRecord & { recommendation: Recommendation })[] = [];
  for (const r of records) {
    const why = exclusionReason(r);
    if (why) excluded[why]++;
    else
      eligible.push(r as DecisionRecord & { recommendation: Recommendation });
  }
  const agrees = (r: (typeof eligible)[number]) =>
    asDecision(r.recommendation) === r.decision;
  const rateOf = (rs: typeof eligible) =>
    wilson(rs.filter(agrees).length, rs.length);

  const byCheck: Record<string, Rate> = {};
  for (const check of [...new Set(eligible.flatMap((r) => r.checks))].sort()) {
    byCheck[check] = rateOf(eligible.filter((r) => r.checks.includes(check)));
  }
  const byRisk: Record<string, Rate> = {};
  for (const risk of ["HIGH", "MEDIUM", "LOW"]) {
    const rs = eligible.filter((r) => r.riskLevel === risk);
    if (rs.length > 0) byRisk[risk] = rateOf(rs);
  }
  const confusion = Object.fromEntries(
    (["APPROVE", "HOLD", "REJECT", "REQUEST_INFO"] as Recommendation[]).map(
      (rec) => [
        rec,
        Object.fromEntries(
          DECISIONS.map((d) => [
            d,
            eligible.filter((r) => r.recommendation === rec && r.decision === d)
              .length,
          ]),
        ),
      ],
    ),
  ) as AgreementReport["confusion"];
  const weeks = [...new Set(eligible.map((r) => weekOf(r.decidedAt)))].sort();
  return {
    eligible: eligible.length,
    excluded,
    overall: rateOf(eligible),
    kappa: cohensKappa(
      eligible.map((r) => ({
        agent: asDecision(r.recommendation),
        analyst: r.decision,
      })),
    ),
    byCheck,
    byRisk,
    confusion,
    weekly: weeks.map((week) => ({
      week,
      rate: rateOf(eligible.filter((r) => weekOf(r.decidedAt) === week)),
    })),
    disagreements: eligible
      .filter((r) => !agrees(r))
      .sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1)),
  };
}

/** Descriptive per-check line (SPEC 9.2); no automation-readiness claims. */
export function checkSummaryLine(
  label: string,
  rate: Rate,
  minimumN: number,
): string {
  if (rate.n < minimumN || rate.rate === null)
    return `${label}: not enough live decisions yet (${rate.n} so far).`;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return `${label}: agreed on ${rate.agree} of ${rate.n} shadow decisions (${pct(rate.rate)}, 95% CI ${pct(rate.low!)} to ${pct(rate.high!)}).`;
}
