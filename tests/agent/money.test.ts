import { describe, expect, it } from "vitest";
import { EvidenceRegistry } from "@/lib/agent/evidence";
import { currencyTokens, moneyMentions } from "@/lib/agent/money";
import { validateOutput } from "@/lib/agent/validator";

const malicious = [
  "$1 000",
  "$1\u202f000",
  "$1\u00a0000",
  "$1_000",
  "$1'000",
  "$1’000",
  "$1×10^9",
  "$1 / 2",
  "999999 × $1",
  "999999 ∕ $1",
  "999999 * NZD 1",
  "1 + $1",
  "The balance is − $1",
  "The balance is - $1",
  "The balance is − NZD1",
  "The balance is - NZD1",
  "The balance is + $1",
  "The balance is \u200b $1",
  "$1 ∕ 2",
  "$1 · 1000",
  "$1 \u200b 000",
  "$1 \u0305 000",
  "$1 ' 000",
  "1 ∕ 2 NZD",
  "$1 + 999",
  "$1 ÷ 2",
  "$1^9",
  "$1\\000",
  "$1\u200b000",
  "$1\u2060000",
  "$1²",
  "$1１",
  "$١",
  "$1e9",
  "$1e+9",
  "$1million",
  "$1 million",
  "$1.000",
  "$1,,000",
  "$1, 000",
  "$1..0",
  "$1.00.01",
  "$1%",
  "$+1",
  "−$1",
  "$1𝟘",
  "$1−999",
  "NZD 1 000",
  "NZD 1_000",
  "NZD 1×10^9",
  "NZD NaN",
  "NZD Infinity",
  "1_000 NZD",
  "1 000 NZD",
  "1\u202f000 NZD",
  "1×10^9 NZD",
  "1 / 2 NZD",
  "1e9 NZD",
  "1 million NZD",
  "١ NZD",
  "１ NZD",
  "1 NZD 999",
  "1 NZD×10^9",
  "1 NZD_000",
  "1:999 NZD",
  "NZD: 999",
  "NZD (999)",
  "(999) NZD",
];
function registry() {
  const r = new EvidenceRegistry("client");
  r.add({
    id: "invoice",
    clientId: "client",
    amountCents: 100,
    issueDate: "2026-10-20",
  });
  return r;
}
function output(
  text: string,
  field: "claim" | "summary" | "question" = "claim",
) {
  return JSON.stringify({
    summary: field === "summary" ? text : "Review the source record.",
    risk_level: "high",
    recommendation: "HOLD",
    questions_for_client: field === "question" ? [text] : [],
    claims: [
      {
        text: field === "claim" ? text : "Review the source record.",
        evidence_ids: ["invoice"],
      },
    ],
    cited_evidence_ids: ["invoice"],
  });
}

describe("complete NZD monetary literals (#186)", () => {
  it.each(malicious)("rejects the complete unsupported token %s", (text) => {
    expect(currencyTokens(text).some((token) => token.cents === null)).toBe(
      true,
    );
    expect(moneyMentions(text)).toEqual([]);
    for (const field of ["claim", "summary", "question"] as const)
      expect(
        validateOutput(output("The amount is " + text + ".", field), registry())
          .ok,
      ).toBe(false);
  });
  it.each([
    "999999. NZD",
    "999999.00 NZD",
    "NZD 999999.00",
    "999999NZD",
    "NZD999999",
    "$999999.00",
  ])("grounds prefix and suffix rather than ignoring %s", (text) => {
    expect(moneyMentions(text)).toEqual([99999900]);
    for (const field of ["claim", "summary", "question"] as const)
      expect(
        validateOutput(output("The amount is " + text + ".", field), registry())
          .ok,
      ).toBe(false);
  });
  it.each([
    ["The amount is $1.00, due on 2026-10-20 [invoice].", [100]],
    ["The amount is 1.00 NZD; compare invoice_123 and bank-9.", [100]],
    ["NZD 1.00 and 1 NZD match $1.", [100, 100, 100]],
    ["($1.00), '$1.00', `$1.00` and NZ$1.00.", [100, 100, 100, 100]],
    ["Currency is NZD. Check invoice_123 on 2026-10-20.", []],
    ["The amount is $1.00: review invoice_123.", [100]],
    ["The amount is $1.00 for INV-NZD_123 and INV-NZD-A1.", [100]],
    ["Invoice INV-NZD_123 cites INV-NZD-123, INV_NZD123 and INV2--NZD_1.", []],
    ["Invoice: NZD1.00.", [100]],
    ["Amounts:\n- $1\n* NZD 1\n+ 1 NZD", [100, 100, 100]],
    ["1 NZD, 1.00 NZD; $1.00 NZD.", [100, 100, 100]],
    ["The amount is $1.00. 2026-10-20 is the due date.", [100]],
  ] as [string, number[]][])(
    "preserves grounded prose: %s",
    (text, expected) => {
      expect(moneyMentions(text)).toEqual(expected);
      expect(validateOutput(output(text), registry()).ok).toBe(true);
    },
  );
  it.each([
    "Balance-NZD 999999.00.",
    "Balance-NZD 999999.00 is due.",
    "Ref-NZD 999999 remains open.",
    "The amount is $1, 000.",
    "The amount is $1. 000.",
    "The amount is $1.00, × 1000.",
    "The amount is $1.00, million.",
    "The balance is '$1.00 million'.",
    "The balance is $1.00 million-dollar exposure.",
    "The balance is $1.00 (million).",
    "The balance is $1.00 thousands.",
    'The balance is $1.00 "bn".',
    "Balance-NZD999999.00 is due.",
    "Ref-NZD999999 is due.",
    "Invoice INV-NZD123 is due.",
    "The balance is Balance-NZD1e9.",
    "The balance is Balance-NZD1million.",
    "The balance is Balance-NZD-1e9.",
    "The balance is 1 NZD.50.",
    "The balance is Balance=999999.00 NZD.",
    "The balance is Total~999999.00 NZD.",
    "The balance is $1.00 - 999999.",
    "The balance is $1**2**.",
    "The balance is $1,000,$1.",
    "The balance is $1*2*.",
    "The balance is $1 * 2.",
  ])("grounds amounts after hyphenated labels and grouping: %s", (text) => {
    for (const field of ["claim", "summary", "question"] as const)
      expect(validateOutput(output(text, field), registry()).ok).toBe(false);
  });
  it.each([
    ["Amounts are $1.00, $1.00.", [100, 100]],
    ["The amount is $1.00. 30 days overdue.", [100]],
    ["The amount is $1.00, 30 days overdue.", [100]],
    ["The amount is $1.00, $1.00 and $1.00.", [100, 100, 100]],
    ["Balance-NZD 1.00 is grounded.", [100]],
    ["The balances are NZD 1.00, 1.00 NZD.", [100, 100]],
    ["Currency (NZD); $1.00 is outstanding.", [100]],
    ["The amount is $1.00. Bank records match.", [100]],
    ["The amount is $1.00 by 2026-10-20.", [100]],
    ["The balance is $1.00. 100 days overdue.", [100]],
    ["The balances are 1.00 NZD, 100 days apart.", [100]],
    ["The balance is $1.00 NZD (2026-10-20).", [100]],
    ["The balance is 1 NZD. 2026-10-20 is the date.", [100]],
    ["The invoice is for NZD $1.00.", [100]],
    ["The invoice is for $1.00 - please reconcile it.", [100]],
    ["Invoice INV-40229 NZD 1.00 is open.", [100]],
    ["The balance is Balance=1.00 NZD.", [100]],
    ["The amount is **$1.00**.", [100]],
    ["The amount is __NZD 1.00__.", [100]],
    ["Amounts are $1.00,$1.00.", [100, 100]],
    ["Amounts:\n1. $1.00\n2. $1.00", [100, 100]],
    ["Amounts:\n- 1.00 NZD\n- 1.00 NZD", [100, 100]],
    ["Invoice INV-40229 NZD $1.00 is open.", [100]],
    ["Amounts:\n2. NZD $1.00", [100]],
    ["The balance is *$1.00*.", [100]],
    ["The balance is _$1.00_.", [100]],
    ["Check inv_0001 and inv_0002 for $1.00.", [100]],
  ] as [string, number[]][])(
    "ends literals at sentence and list boundaries: %s",
    (text, expected) => {
      expect(moneyMentions(text)).toEqual(expected);
      expect(validateOutput(output(text), registry()).ok).toBe(true);
    },
  );
  it("preserves grounded negative literals at a real currency boundary", () => {
    const r = new EvidenceRegistry("client");
    r.add({ id: "invoice", clientId: "client", amountCents: -100 });
    for (const text of [
      "The balance is -NZD1.",
      "The balance is -$1.",
      "The balance is NZD -1.",
      "The balance is $-1.",
    ]) {
      expect(moneyMentions(text)).toEqual([-100]);
      expect(validateOutput(output(text), r).ok).toBe(true);
    }
  });
  it("keeps cents exact at positive/negative safe integer boundaries", () => {
    expect(
      moneyMentions("$90071992547409.91 and -90071992547409.91 NZD"),
    ).toEqual([Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]);
    expect(currencyTokens("$90071992547409.92")[0].cents).toBeNull();
    expect(moneyMentions("-$0.01 and $-0.99 and -1 NZD")).toEqual([
      -1, -99, -100,
    ]);
  });
  it.each([
    "999 USD",
    "USD 999",
    "999 EUR",
    "EUR 999",
    "999 €",
    "999 £",
    "999 ¥",
    "＄999",
    "₹999",
  ])("rejects unsupported currency %s", (text) => {
    expect(validateOutput(output(text), registry()).ok).toBe(false);
  });
  it("does not round malformed evidence into a supported claim", () => {
    for (const record of [
      { amountCents: 100.1 },
      { amount: 1.000000001 },
      { amountCents: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      const r = new EvidenceRegistry("client");
      r.add({ id: "invoice", clientId: "client", ...record });
      expect(validateOutput(output("The amount is $1.00."), r).ok).toBe(false);
    }
  });
});
