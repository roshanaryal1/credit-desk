import { describe, expect, it } from "vitest";

import { CHECK_CONFIG, CONFIG_VERSION } from "@/lib/checks/config";
import { ALL_CHECKS, runChecks, statusFor } from "@/lib/checks";
import type { CheckContext, CheckId } from "@/lib/checks/types";
import { addDays } from "@/lib/dates";
import {
  makeContext,
  makeInvoice,
  makeLedger,
  makeOther,
  makeOutstanding,
  makePayment,
  makeReceipt,
  paymentsTaking,
} from "@/tests/checks/fixtures";

function check(id: CheckId, ctx: CheckContext = makeContext()) {
  return ALL_CHECKS[id](ctx.invoice, ctx);
}

describe("DUP", () => {
  it("flags another submission of the same number and cites it", () => {
    expect(
      check(
        "DUP",
        makeContext({
          otherInvoices: [
            makeOther({
              amountCents: 1,
              debtorId: "dbt_other",
              issueDate: "2025-01-01",
            }),
          ],
        }),
      ),
    ).toMatchObject({
      checkId: "DUP",
      severity: "HIGH",
      evidenceIds: ["inv_subject", "inv_other"],
    });
  });
  it("does not match another client or a different debtor and number", () => {
    expect(
      check(
        "DUP",
        makeContext({
          otherInvoices: [
            makeOther({ clientId: "cli_other" }),
            makeOther({ debtorId: "dbt_other", invoiceNumber: "OTHER" }),
          ],
        }),
      ),
    ).toBeNull();
  });
  it.each([-7, 7])(
    "matches equal debtor and amount at the %i-day boundary",
    (days) => {
      expect(
        check(
          "DUP",
          makeContext({
            otherInvoices: [
              makeOther({
                invoiceNumber: "OTHER",
                issueDate: addDays("2026-10-01", days),
              }),
            ],
          }),
        ),
      ).not.toBeNull();
    },
  );
  it.each([-8, 8])("excludes issue dates %i days apart", (days) => {
    expect(
      check(
        "DUP",
        makeContext({
          otherInvoices: [
            makeOther({
              invoiceNumber: "OTHER",
              issueDate: addDays("2026-10-01", days),
            }),
          ],
        }),
      ),
    ).toBeNull();
  });
  it("excludes itself", () => {
    expect(
      check(
        "DUP",
        makeContext({ otherInvoices: [makeOther({ id: "inv_subject" })] }),
      ),
    ).toBeNull();
  });
  it("excludes a VOIDED original superseded by this invoice", () => {
    expect(
      check(
        "DUP",
        makeContext({
          otherInvoices: [makeOther({ ledgerStatus: "VOIDED" })],
          supersededLedgerEntryIds: ["led_other"],
        }),
      ),
    ).toBeNull();
  });
  it("still flags superseded but authorised originals and unrelated voids", () => {
    expect(
      check(
        "DUP",
        makeContext({
          otherInvoices: [makeOther()],
          supersededLedgerEntryIds: ["led_other"],
        }),
      ),
    ).not.toBeNull();
    expect(
      check(
        "DUP",
        makeContext({ otherInvoices: [makeOther({ ledgerStatus: "VOIDED" })] }),
      ),
    ).not.toBeNull();
  });
});

describe("LEDGER_MISSING", () => {
  it("flags a missing entry", () => {
    expect(
      check("LEDGER_MISSING", makeContext({ ledgerEntry: null })),
    ).toMatchObject({ severity: "HIGH", evidenceIds: ["inv_subject"] });
  });
  it("accepts a recorded entry", () =>
    expect(check("LEDGER_MISSING")).toBeNull());
  it("accepts an entry recorded on submission day even without a status", () => {
    expect(
      check(
        "LEDGER_MISSING",
        makeContext({
          ledgerEntry: makeLedger({ recordedDate: "2026-10-23", status: null }),
        }),
      ),
    ).toBeNull();
  });
});

describe("LEDGER_MISMATCH", () => {
  it.each([
    { amountCents: 100_01 },
    { debtorId: "dbt_other" },
    { issueDate: "2026-10-02" },
  ])("flags a differing field: %o", (difference) => {
    expect(
      check(
        "LEDGER_MISMATCH",
        makeContext({ ledgerEntry: makeLedger(difference) }),
      ),
    ).toMatchObject({
      severity: "HIGH",
      evidenceIds: ["inv_subject", "led_subject"],
    });
  });
  it("accepts an exact match", () =>
    expect(check("LEDGER_MISMATCH")).toBeNull());
  it("leaves a missing entry to LEDGER_MISSING", () =>
    expect(
      check("LEDGER_MISMATCH", makeContext({ ledgerEntry: null })),
    ).toBeNull());
});

describe("VOIDED", () => {
  it("flags a voided ledger entry", () => {
    expect(
      check(
        "VOIDED",
        makeContext({ ledgerEntry: makeLedger({ status: "VOIDED" }) }),
      ),
    ).toMatchObject({
      severity: "HIGH",
      evidenceIds: ["inv_subject", "led_subject"],
    });
  });
  it("accepts an authorised entry", () => expect(check("VOIDED")).toBeNull());
  it("does not infer a void from missing status or ledger", () => {
    expect(
      check(
        "VOIDED",
        makeContext({ ledgerEntry: makeLedger({ status: null }) }),
      ),
    ).toBeNull();
    expect(check("VOIDED", makeContext({ ledgerEntry: null }))).toBeNull();
  });
});

describe("CREDIT_NOTE", () => {
  const withNotes = (...amounts: number[]) =>
    makeContext({
      ledgerEntry: makeLedger({
        creditNotes: amounts.map((amountCents, index) => ({
          id: `cn_${index}`,
          ledgerEntryId: "led_subject",
          date: "2026-10-23",
          amountCents,
        })),
      }),
    });
  it("sums notes and flags over 20% as high", () => {
    expect(check("CREDIT_NOTE", withNotes(1000, 1001))).toMatchObject({
      severity: "HIGH",
      details: { creditedCents: 2001 },
      evidenceIds: ["inv_subject", "led_subject", "cn_0", "cn_1"],
    });
  });
  it("accepts no credit notes or missing ledger", () => {
    expect(check("CREDIT_NOTE")).toBeNull();
    expect(check("CREDIT_NOTE", makeContext({ ledgerEntry: null }))).toBeNull();
  });
  it("keeps exactly 20% at medium", () =>
    expect(check("CREDIT_NOTE", withNotes(2000))?.severity).toBe("MEDIUM"));
  it("flags even a zero-value credit note at medium", () =>
    expect(check("CREDIT_NOTE", withNotes(0))?.severity).toBe("MEDIUM"));
});

describe("ALREADY_PAID", () => {
  it("sums allocated amounts and cites bank lines", () => {
    expect(
      check(
        "ALREADY_PAID",
        makeContext({
          receiptAllocations: [
            makeReceipt(5000, "bank_a"),
            makeReceipt(5000, "bank_b"),
          ],
        }),
      ),
    ).toMatchObject({
      severity: "HIGH",
      details: { allocatedCents: 10000 },
      evidenceIds: ["inv_subject", "led_subject", "bank_a", "bank_b"],
    });
  });
  it("leaves partial payments clean even when the bank line covers more", () => {
    expect(
      check(
        "ALREADY_PAID",
        makeContext({ receiptAllocations: [makeReceipt(5000)] }),
      ),
    ).toBeNull();
  });
  it.each([
    [9899, false],
    [9900, true],
  ])("tests %i cents against 99%", (amount, flagged) => {
    expect(
      check(
        "ALREADY_PAID",
        makeContext({ receiptAllocations: [makeReceipt(amount)] }),
      ) !== null,
    ).toBe(flagged);
  });
  it("does not treat a PAID status or zero invoice without receipts as evidence of coverage", () => {
    expect(
      check(
        "ALREADY_PAID",
        makeContext({ ledgerEntry: makeLedger({ status: "PAID" }) }),
      ),
    ).toBeNull();
    expect(
      check(
        "ALREADY_PAID",
        makeContext({ invoice: makeInvoice({ amountCents: 0 }) }),
      ),
    ).toBeNull();
  });
});

describe("NEW_DEBTOR", () => {
  it("flags a recent debtor even with payment history", () => {
    expect(
      check(
        "NEW_DEBTOR",
        makeContext({
          debtor: { id: "dbt_test", firstSeenDate: "2026-10-01" },
        }),
      ),
    ).toMatchObject({
      severity: "MEDIUM",
      evidenceIds: ["inv_subject", "dbt_test", "pay_history"],
    });
  });
  it("accepts an established debtor with history older than the slow-payer window", () => {
    expect(
      check(
        "NEW_DEBTOR",
        makeContext({
          debtorPayments: [],
          priorPayment: makePayment({
            paidDate: "2025-01-31",
            issueDate: "2025-01-01",
          }),
        }),
      ),
    ).toBeNull();
  });
  it.each([
    [59, true],
    [60, false],
  ])("tests %i days since first seen", (days, flagged) => {
    expect(
      check(
        "NEW_DEBTOR",
        makeContext({
          debtor: {
            id: "dbt_test",
            firstSeenDate: addDays("2026-10-23", -days),
          },
        }),
      ) !== null,
    ).toBe(flagged);
  });
  it("flags an old debtor with no payment history", () => {
    expect(
      check(
        "NEW_DEBTOR",
        makeContext({ debtorPayments: [], priorPayment: null }),
      )?.details.hasPaymentHistory,
    ).toBe(false);
  });
});

describe("SLOW_PAYER", () => {
  it("flags a mean above terms plus grace and cites every payment", () => {
    expect(
      check(
        "SLOW_PAYER",
        makeContext({ debtorPayments: paymentsTaking([30, 70, 83]) }),
      ),
    ).toMatchObject({
      severity: "MEDIUM",
      details: { meanDaysToPay: 61, paymentCount: 3 },
      evidenceIds: ["inv_subject", "cli_test", "pay_0", "pay_1", "pay_2"],
    });
  });
  it("accepts on-time payments", () =>
    expect(
      check(
        "SLOW_PAYER",
        makeContext({ debtorPayments: paymentsTaking([20, 30, 40]) }),
      ),
    ).toBeNull());
  it("accepts exactly terms plus grace", () =>
    expect(
      check(
        "SLOW_PAYER",
        makeContext({ debtorPayments: paymentsTaking([30, 70, 80]) }),
      ),
    ).toBeNull());
  it("requires at least three payments", () =>
    expect(
      check(
        "SLOW_PAYER",
        makeContext({ debtorPayments: paymentsTaking([80, 80]) }),
      ),
    ).toBeNull());
  it("uses the client's terms and does not round the mean", () => {
    expect(
      check(
        "SLOW_PAYER",
        makeContext({ debtorPayments: paymentsTaking([60, 60, 61]) }),
      ),
    ).not.toBeNull();
    expect(
      check(
        "SLOW_PAYER",
        makeContext({
          client: {
            id: "cli_test",
            advanceRateBps: 8000,
            paymentTermsDays: 60,
          },
          debtorPayments: paymentsTaking([60, 60, 61]),
        }),
      ),
    ).toBeNull();
  });
});

describe("OVER_AGE", () => {
  it("flags 91 days", () =>
    expect(
      check(
        "OVER_AGE",
        makeContext({
          invoice: makeInvoice({ issueDate: addDays("2026-10-23", -91) }),
        }),
      ),
    ).toMatchObject({ severity: "HIGH", details: { ageDays: 91 } }));
  it("accepts a recent invoice", () => expect(check("OVER_AGE")).toBeNull());
  it("accepts exactly 90 days", () =>
    expect(
      check(
        "OVER_AGE",
        makeContext({
          invoice: makeInvoice({ issueDate: addDays("2026-10-23", -90) }),
        }),
      ),
    ).toBeNull());
});

describe("FUTURE_DATED", () => {
  it("flags tomorrow", () =>
    expect(
      check(
        "FUTURE_DATED",
        makeContext({ invoice: makeInvoice({ issueDate: "2026-10-24" }) }),
      ),
    ).toMatchObject({ severity: "HIGH", evidenceIds: ["inv_subject"] }));
  it("accepts the past", () => expect(check("FUTURE_DATED")).toBeNull());
  it("accepts submission day", () =>
    expect(
      check(
        "FUTURE_DATED",
        makeContext({ invoice: makeInvoice({ issueDate: "2026-10-23" }) }),
      ),
    ).toBeNull());
});

describe("CONCENTRATION", () => {
  it("flags a share over 30% and cites only this debtor's records", () => {
    const ctx = makeContext({
      outstandingFaceValueByDebtor: [
        makeOutstanding(
          makeInvoice({
            id: "inv_funded",
            debtorId: "dbt_other",
            amountCents: 20000,
          }),
        ),
      ],
    });
    expect(check("CONCENTRATION", ctx)).toMatchObject({
      severity: "MEDIUM",
      details: { debtorCents: 10000, totalCents: 30000, shareBps: 3333 },
    });
    const evidence = check("CONCENTRATION", ctx)?.evidenceIds ?? [];
    expect(evidence).toContain("inv_subject");
    // Other debtors' records stay out of the evidence; totals are in details.
    expect(evidence).not.toContain("inv_funded");
    expect(evidence).not.toContain("fund_inv_funded");
  });
  it("accepts a diversified book", () =>
    expect(check("CONCENTRATION")).toBeNull());
  it("does not evaluate a zero total", () => {
    expect(
      check(
        "CONCENTRATION",
        makeContext({
          invoice: makeInvoice({ amountCents: 0 }),
          outstandingFaceValueByDebtor: [],
        }),
      ),
    ).toBeNull();
  });
  it("accepts exactly 30%", () => {
    expect(
      check(
        "CONCENTRATION",
        makeContext({
          invoice: makeInvoice({ amountCents: 30000 }),
          outstandingFaceValueByDebtor: [
            makeOutstanding(
              makeInvoice({
                id: "inv_other",
                debtorId: "dbt_other",
                amountCents: 70000,
              }),
            ),
          ],
        }),
      ),
    ).toBeNull();
  });
  it("counts each invoice once when already funded and also in the batch", () => {
    const ctx = makeContext({
      outstandingFaceValueByDebtor: [
        makeOutstanding(
          makeInvoice({
            id: "inv_funded",
            debtorId: "dbt_other",
            amountCents: 30000,
          }),
        ),
      ],
    });
    ctx.outstandingFaceValueByDebtor.push(makeOutstanding(ctx.invoice));
    ctx.batchInvoices.push(ctx.invoice);
    expect(check("CONCENTRATION", ctx)).toBeNull();
  });
  it("compares the exact share before rounding to basis points", () => {
    const ctx = makeContext({
      invoice: makeInvoice({ amountCents: 30001 }),
      outstandingFaceValueByDebtor: [
        makeOutstanding(
          makeInvoice({
            id: "inv_other",
            debtorId: "dbt_other",
            amountCents: 70000,
          }),
        ),
      ],
    });
    expect(check("CONCENTRATION", ctx)).toMatchObject({
      severity: "MEDIUM",
      details: { shareBps: 3000 },
    });
  });
  it("includes all this debtor's batch and funded invoices", () => {
    const ctx = makeContext({
      batchInvoices: [
        makeInvoice(),
        makeInvoice({ id: "inv_batch_2", amountCents: 40000 }),
      ],
      outstandingFaceValueByDebtor: [
        makeOutstanding(makeInvoice({ id: "inv_funded", amountCents: 10000 })),
      ],
    });
    expect(check("CONCENTRATION", ctx)?.details).toEqual({
      debtorCents: 60000,
      totalCents: 60000,
      shareBps: 10000,
    });
  });
});

describe("registry and status", () => {
  it("registers all eleven checks with CI metrics", () => {
    expect(Object.keys(ALL_CHECKS)).toHaveLength(11);
    expect(Object.keys(CHECK_CONFIG.minimumMetrics)).toEqual(
      Object.keys(ALL_CHECKS),
    );
    expect(CONFIG_VERSION).toBe("2026-10-23.1");
    for (const metrics of Object.values(CHECK_CONFIG.minimumMetrics))
      expect(metrics).toEqual({ precision: 0.8, recall: 0.8 });
  });
  it("returns CLEAR for a clean context", () => {
    const ctx = makeContext();
    expect(runChecks(ctx.invoice, ctx)).toEqual([]);
    expect(statusFor([])).toBe("CLEAR");
  });
  it("returns FLAGGED with medium or low findings, HIGH_RISK with any high", () => {
    const medium = {
      checkId: "NEW_DEBTOR" as const,
      severity: "MEDIUM" as const,
      details: {},
      evidenceIds: [],
    };
    expect(statusFor([medium])).toBe("FLAGGED");
    expect(statusFor([{ ...medium, severity: "LOW" }])).toBe("FLAGGED");
    expect(statusFor([medium, { ...medium, severity: "HIGH" }])).toBe(
      "HIGH_RISK",
    );
  });
  it("returns every finding deterministically without mutating the snapshot", () => {
    const ctx = makeContext({
      ledgerEntry: null,
      debtorPayments: [],
      priorPayment: null,
      invoice: makeInvoice({ issueDate: "2026-01-01" }),
    });
    const before = structuredClone(ctx);
    const findings = runChecks(ctx.invoice, ctx);
    expect(findings.map((finding) => finding.checkId)).toEqual([
      "LEDGER_MISSING",
      "NEW_DEBTOR",
      "OVER_AGE",
    ]);
    expect(runChecks(ctx.invoice, ctx)).toEqual(findings);
    expect(ctx).toEqual(before);
  });
});
