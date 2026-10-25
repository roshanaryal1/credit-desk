import { describe, expect, it } from "vitest";

import { EvidenceRegistry } from "@/lib/agent/evidence";
import {
  dateMentions,
  moneyMentions,
  validateOutput,
} from "@/lib/agent/validator";

const registry = () => {
  const r = new EvidenceRegistry("cli_1");
  r.add({
    id: "inv_1",
    clientId: "cli_1",
    type: "invoice",
    amount: 12345.67,
    issueDate: "2026-09-01",
  });
  r.add({
    id: "led_1",
    clientId: "cli_1",
    type: "ledger_entry",
    amount: 10000,
    status: "VOIDED",
    statusDate: "2026-09-10",
  });
  r.add({
    id: "fdg_1",
    clientId: "cli_1",
    type: "finding",
    details: { allocatedCents: 1234567 },
  });
  return r;
};

const good = {
  summary:
    "Ledger entry led_1 is voided and holds $10,000.00 against an invoice of $12,345.67.",
  risk_level: "high",
  recommendation: "REJECT",
  questions_for_client: ["Why was the invoice voided on 2026-09-10?"],
  claims: [
    {
      text: "The invoice is for $12,345.67, issued 2026-09-01.",
      evidence_ids: ["inv_1"],
    },
    {
      text: "The ledger shows $10,000.00, voided on 2026-09-10.",
      evidence_ids: ["led_1"],
    },
  ],
  cited_evidence_ids: ["inv_1", "led_1"],
};

const run = (o: unknown) => validateOutput(JSON.stringify(o), registry());

describe("citation validator", () => {
  it("accepts a grounded explanation", () => {
    expect(run(good)).toMatchObject({ ok: true });
  });

  it("accepts JSON wrapped in prose or a code fence", () => {
    expect(
      validateOutput("```json\n" + JSON.stringify(good) + "\n```", registry())
        .ok,
    ).toBe(true);
  });

  it("rejects text that is not JSON", () => {
    const r = validateOutput("I think it is fine.", registry());
    expect(r.ok).toBe(false);
  });

  it("rejects a schema violation", () => {
    const r = run({ ...good, risk_level: "severe" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/risk_level/);
  });

  it("rejects a summary over 60 words", () => {
    const r = run({ ...good, summary: Array(61).fill("word").join(" ") });
    expect(r.ok).toBe(false);
  });

  it("rejects an id that no tool returned", () => {
    const r = run({ ...good, cited_evidence_ids: ["inv_1", "bnk_999"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/bnk_999/);
  });

  it("rejects an amount that is not in the claim's cited records", () => {
    const r = run({
      ...good,
      claims: [
        { text: "The invoice is for $12,999.00.", evidence_ids: ["inv_1"] },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/\$12999\.00/);
  });

  it("rejects an amount that is real but cited from the wrong record", () => {
    const r = run({
      ...good,
      claims: [
        { text: "The ledger holds $12,345.67.", evidence_ids: ["led_1"] },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an invented date", () => {
    const r = run({
      ...good,
      claims: [{ text: "Voided on 2026-09-11.", evidence_ids: ["led_1"] }],
    });
    expect(r.ok).toBe(false);
  });

  it("matches cents fields in finding details", () => {
    const r = run({
      ...good,
      claims: [
        {
          text: "Receipts of $12,345.67 were allocated.",
          evidence_ids: ["fdg_1"],
        },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects an explanation that claims approval", () => {
    const r = run({ ...good, summary: "This invoice is approved." });
    expect(r.ok).toBe(false);
  });

  it.each([
    ["Why is the balance $99,999.99?", /question 1 states \$99999\.99/],
    ["Why was it changed on 2035-01-01?", /question 1 states 2035-01-01/],
    ["Your advance was approved. Please confirm.", /never approves or funds/],
  ])("checks displayed client questions: %s", (question, error) => {
    const result = run({ ...good, questions_for_client: [question] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(error);
  });

  it("accepts questions without factual amounts and questions grounded in cited records", () => {
    expect(
      run({
        ...good,
        questions_for_client: [
          "Can you provide the original invoice?",
          "Why was the $10,000.00 ledger entry voided on 2026-09-10?",
        ],
      }).ok,
    ).toBe(true);
  });

  it("rejects an id belonging to another client at registration", () => {
    expect(() =>
      new EvidenceRegistry("cli_1").add({ id: "x", clientId: "cli_2" }),
    ).toThrow(/another client/);
  });
});

describe("money evidence", () => {
  it.each([
    "NZD 999999.00",
    "$1e9",
    "$1 million",
    "$.50",
    "$+999999.00",
    "NZ$999999.00",
    "USD 1.00",
  ])("rejects unsupported or ungrounded currency: %s", (amount) => {
    const evidence = new EvidenceRegistry("cli_1");
    evidence.add({ id: "one", clientId: "cli_1", amountCents: 100 });
    for (const field of ["summary", "claim", "question"]) {
      const output = {
        ...good,
        summary:
          field === "summary" ? `Balance ${amount}.` : "Review the balance.",
        claims: [
          {
            text: field === "claim" ? `Balance ${amount}.` : "Balance $1.00.",
            evidence_ids: ["one"],
          },
        ],
        questions_for_client:
          field === "question" ? [`Why is the balance ${amount}?`] : [],
        cited_evidence_ids: ["one"],
      };
      expect(validateOutput(JSON.stringify(output), evidence).ok).toBe(false);
    }
  });

  it("supports conventional NZD amounts, signed cents and sentence punctuation", () => {
    expect(
      moneyMentions("$1.00, NZD 1.00, NZ$1.00. -NZD 1.00 and NZ$-1.00"),
    ).toEqual([100, 100, 100, -100, -100]);
    const evidence = new EvidenceRegistry("cli_1");
    evidence.add({ id: "one", clientId: "cli_1", amountCents: 100 });
    expect(
      validateOutput(
        JSON.stringify({
          ...good,
          summary: "Balance NZD 1.00.",
          claims: [
            { text: "Balance NZ$1.00, please check.", evidence_ids: ["one"] },
          ],
          questions_for_client: ["Can you verify the $1.00 invoice?"],
          cited_evidence_ids: ["one"],
        }),
        evidence,
      ).ok,
    ).toBe(true);
  });

  it("rejects oversized client questions at the schema boundary", () => {
    expect(run({ ...good, questions_for_client: ["x".repeat(1001)] }).ok).toBe(
      false,
    );
  });
  it.each(["$12,345.671", "$12,34.56", "$12345.67.8"])(
    "rejects a malformed amount instead of matching a prefix: %s",
    (amount) => {
      const result = run({
        ...good,
        claims: [
          { text: `The invoice is for ${amount}.`, evidence_ids: ["inv_1"] },
        ],
      });
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.errors.join()).toMatch(/invalid dollar amount/);
    },
  );

  it("accepts a grammatical comma after a grounded dollar amount", () => {
    expect(
      run({
        ...good,
        claims: [
          {
            text: "The invoice is for $12,345.67, issued 2026-09-01.",
            evidence_ids: ["inv_1"],
          },
        ],
      }).ok,
    ).toBe(true);
  });
  it("reads ungrouped amounts of four or more digits in full", () => {
    expect(moneyMentions("$12345.67 and $1234 and $1,234.56")).toEqual([
      1234567, 123400, 123456,
    ]);
  });

  it("does not accept an invented ungrouped amount that shares leading digits", () => {
    const r = new EvidenceRegistry("cli_1");
    r.add({ id: "x", clientId: "cli_1", amount: 123 });
    const out = validateOutput(
      JSON.stringify({
        ...good,
        claims: [{ text: "Paid $12345.67.", evidence_ids: ["x"] }],
        cited_evidence_ids: ["x"],
        summary: "Paid.",
      }),
      r,
    );
    expect(out.ok).toBe(false);
  });

  it("keeps the sign of negative amounts so they cannot match positive evidence", () => {
    expect(moneyMentions("-$100.00 and $-999.00 and $5")).toEqual([
      -10000, -99900, 500,
    ]);
    const r = new EvidenceRegistry("cli_1");
    r.add({ id: "x", clientId: "cli_1", amount: 100 });
    const out = validateOutput(
      JSON.stringify({
        ...good,
        claims: [{ text: "Balance -$100.00.", evidence_ids: ["x"] }],
        cited_evidence_ids: ["x"],
        summary: "Balance.",
      }),
      r,
    );
    expect(out.ok).toBe(false);
  });

  it("never treats days, counts or basis points as money", () => {
    const r = new EvidenceRegistry("cli_1");
    r.add({
      id: "pay",
      clientId: "cli_1",
      daysToPay: 45,
      paymentCount: 3,
      shareBps: 4500,
    });
    const out = validateOutput(
      JSON.stringify({
        ...good,
        claims: [{ text: "Paid $45.00.", evidence_ids: ["pay"] }],
        cited_evidence_ids: ["pay"],
        summary: "Paid.",
      }),
      r,
    );
    expect(out.ok).toBe(false);
  });
});

describe("mention parsing", () => {
  it("reads dollar amounts as cents", () => {
    expect(moneyMentions("$1,234.5 and $7 and $12,345.67")).toEqual([
      123450, 700, 1234567,
    ]);
  });
  it("reads ISO dates", () => {
    expect(dateMentions("on 2026-10-01 and 2026-10-02.")).toEqual([
      "2026-10-01",
      "2026-10-02",
    ]);
  });
});
