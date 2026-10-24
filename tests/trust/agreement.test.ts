import { describe, expect, it } from "vitest";

import {
  agreementReport,
  checkSummaryLine,
  cohensKappa,
  exclusionReason,
  weekOf,
  wilson,
  type DecisionRecord,
} from "@/lib/trust/agreement";

const rec = (over: Partial<DecisionRecord>): DecisionRecord => ({
  decisionId: "d",
  invoiceId: "i",
  decision: "HOLD",
  mode: "SHADOW",
  exposed: false,
  simulated: false,
  decidedAt: "2026-10-20T01:00:00Z",
  priorDecisions: 0,
  recommendation: "HOLD",
  explanationPassed: true,
  riskLevel: "HIGH",
  checks: ["DUP"],
  ...over,
});

describe("eligibility", () => {
  it("excludes assist, exposed, revisions and missing explanations", () => {
    expect(exclusionReason(rec({ mode: "ASSIST" }))).toBe("ASSIST_MODE");
    expect(exclusionReason(rec({ exposed: true }))).toBe(
      "EXPOSED_BEFORE_DECISION",
    );
    expect(exclusionReason(rec({ priorDecisions: 1 }))).toBe("REVISION");
    expect(exclusionReason(rec({ explanationPassed: false }))).toBe(
      "NO_VALID_EXPLANATION",
    );
    expect(exclusionReason(rec({ checks: [] }))).toBe("NOT_FLAGGED");
    expect(exclusionReason(rec({}))).toBeNull();
  });
});

describe("Cohen's kappa", () => {
  it("is 1 for perfect agreement with variety", () => {
    expect(
      cohensKappa([
        { agent: "APPROVE", analyst: "APPROVE" },
        { agent: "REJECT", analyst: "REJECT" },
      ]),
    ).toBe(1);
  });

  it("matches a hand-worked example", () => {
    // 10 pairs: agent APPROVE x5 (analyst 4 APPROVE, 1 HOLD), agent HOLD x5 (analyst 1 APPROVE, 4 HOLD).
    const pairs = [
      ...Array(4).fill({ agent: "APPROVE", analyst: "APPROVE" }),
      { agent: "APPROVE", analyst: "HOLD" },
      { agent: "HOLD", analyst: "APPROVE" },
      ...Array(4).fill({ agent: "HOLD", analyst: "HOLD" }),
    ];
    // po = 0.8, pe = 0.5*0.5 + 0.5*0.5 = 0.5, kappa = 0.6
    expect(cohensKappa(pairs)).toBeCloseTo(0.6, 10);
  });

  it("is undefined (null) when expected agreement is 1 or there is no data", () => {
    expect(cohensKappa([{ agent: "HOLD", analyst: "HOLD" }])).toBeNull();
    expect(cohensKappa([])).toBeNull();
  });
});

describe("Wilson interval", () => {
  it("matches the textbook value for 8 of 10", () => {
    const r = wilson(8, 10);
    expect(r.low).toBeCloseTo(0.4902, 3);
    expect(r.high).toBeCloseTo(0.9433, 3);
  });
  it("is null with no observations", () => {
    expect(wilson(0, 0).rate).toBeNull();
  });
});

describe("agreement report", () => {
  it("maps REQUEST_INFO to HOLD but keeps it in the confusion matrix", () => {
    const r = agreementReport([
      rec({ recommendation: "REQUEST_INFO", decision: "HOLD" }),
    ]);
    expect(r.overall.rate).toBe(1);
    expect(r.confusion.REQUEST_INFO.HOLD).toBe(1);
  });

  it("counts a decision toward every check that fired and lists disagreements newest first", () => {
    const r = agreementReport([
      rec({
        decisionId: "a",
        checks: ["DUP", "VOIDED"],
        decision: "REJECT",
        recommendation: "REJECT",
        decidedAt: "2026-10-01T00:00:00Z",
      }),
      rec({
        decisionId: "b",
        checks: ["DUP"],
        decision: "APPROVE",
        recommendation: "REJECT",
        decidedAt: "2026-10-02T00:00:00Z",
      }),
      rec({
        decisionId: "c",
        checks: ["DUP"],
        decision: "HOLD",
        recommendation: "APPROVE",
        decidedAt: "2026-10-03T00:00:00Z",
      }),
      rec({ decisionId: "x", mode: "ASSIST" }),
    ]);
    expect(r.eligible).toBe(3);
    expect(r.excluded.ASSIST_MODE).toBe(1);
    expect(r.byCheck.DUP).toMatchObject({ agree: 1, n: 3 });
    expect(r.byCheck.VOIDED).toMatchObject({ agree: 1, n: 1 });
    expect(r.disagreements.map((d) => d.decisionId)).toEqual(["c", "b"]);
  });

  it("groups weeks by Monday in NZ time", () => {
    // Sunday 2026-10-18 23:30 NZDT is 10:30 UTC on the same day.
    expect(weekOf("2026-10-18T10:30:00Z")).toBe("2026-10-12");
    // Monday 2026-10-19 00:30 NZDT is 11:30 UTC on Sunday.
    expect(weekOf("2026-10-18T11:30:00Z")).toBe("2026-10-19");
  });
});

describe("summary line", () => {
  it("is descriptive and withholds rates below the minimum sample", () => {
    expect(checkSummaryLine("Possible duplicate", wilson(3, 4), 10)).toMatch(
      /not enough live decisions yet \(4 so far\)/,
    );
    expect(checkSummaryLine("Possible duplicate", wilson(31, 33), 10)).toMatch(
      /agreed on 31 of 33 shadow decisions \(94%, 95% CI 80% to 98%\)/,
    );
  });
});
