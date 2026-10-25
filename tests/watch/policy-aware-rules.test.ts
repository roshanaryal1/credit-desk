import { describe, expect, it } from "vitest";

import {
  runWatchRules,
  runWatchRulesWithPolicies,
} from "@/lib/watch/rules";
import type { RiskPolicy } from "@/lib/watch/policy";
import type { Book } from "@/lib/watch/types";

const oldPolicy: RiskPolicy = {
  id: "policy-client-a-v1",
  clientId: "client-a",
  effectiveFrom: "2026-09-01",
  approvedBy: "synthetic-reviewer-b",
  approvedAt: "2026-08-31T08:00:00Z",
  thresholds: {
    driftIncreaseDays: 15,
    overdueDays: 30,
    concentrationBps: 3000,
    facilityBps: 9000,
  },
  escalation: { mediumAfterDays: 2, highAfterDays: 5 },
};
const revisedPolicy: RiskPolicy = {
  ...oldPolicy,
  id: "policy-client-a-v2",
  effectiveFrom: "2026-10-20",
  approvedAt: "2026-10-19T08:00:00Z",
  thresholds: { ...oldPolicy.thresholds, overdueDays: 10 },
};
const otherPolicy: RiskPolicy = {
  ...oldPolicy,
  id: "policy-client-b-v1",
  clientId: "client-b",
  thresholds: { ...oldPolicy.thresholds, overdueDays: 30 },
};

function makeBook(asOf: string): Book {
  return {
    asOf,
    clients: [
      { id: "client-a", facilityLimitCents: 1_000_000 },
      { id: "client-b", facilityLimitCents: 1_000_000 },
    ],
    fundings: [
      {
        id: "funding-a",
        invoiceId: "invoice-a",
        clientId: "client-a",
        debtorId: "debtor-a",
        ledgerEntryId: "ledger-a",
        dueDate: "2026-10-05",
        fundedDate: "2026-09-20",
        advanceCents: 20_000,
        adjustments: [],
      },
      {
        id: "funding-b",
        invoiceId: "invoice-b",
        clientId: "client-b",
        debtorId: "debtor-b",
        ledgerEntryId: "ledger-b",
        dueDate: "2026-10-05",
        fundedDate: "2026-09-20",
        advanceCents: 20_000,
        adjustments: [],
      },
    ],
    creditNotes: [
      {
        id: "credit-note-b",
        ledgerEntryId: "ledger-b",
        date: "2026-10-10",
        amountCents: 500,
      },
    ],
    payments: [],
  };
}

describe("opt-in policy-aware watch evaluation (#101)", () => {
  it("preserves existing defaults and changes only the effective client's thresholds", () => {
    const book = makeBook("2026-10-20");
    const original = runWatchRules(book);
    expect(original.map((detection) => detection.ruleId)).toEqual([
      "FUNDED_CREDIT_NOTE",
    ]);
    const governed = runWatchRulesWithPolicies(
      book,
      [oldPolicy, revisedPolicy, otherPolicy],
    );
    expect(governed.map((detection) => detection.ruleId)).toEqual([
      "FUNDED_CREDIT_NOTE",
      "OVERDUE_FUNDED",
    ]);
    expect(governed.find((detection) =>
      detection.ruleId === "OVERDUE_FUNDED",
    )).toMatchObject({
      clientId: "client-a",
      details: {
        riskPolicyId: "policy-client-a-v2",
        riskPolicyEffectiveFrom: "2026-10-20",
        daysOverdue: 15,
      },
    });
    expect(governed.find((detection) =>
      detection.ruleId === "FUNDED_CREDIT_NOTE",
    )?.details).toMatchObject({
      riskPolicyId: "policy-client-b-v1",
    });
    // The rule registry and input book are unchanged by the preview.
    expect(runWatchRules(book)).toEqual(original);
    expect(book.fundings.map((item) => item.advanceCents)).toEqual([
      20_000,
      20_000,
    ]);
  });

  it("selects historical versions without retroactively changing detections", () => {
    const before = runWatchRulesWithPolicies(
      makeBook("2026-10-19"),
      [revisedPolicy, otherPolicy, oldPolicy],
    );
    expect(before.map((detection) => detection.ruleId)).toEqual([
      "FUNDED_CREDIT_NOTE",
    ]);
    const after = runWatchRulesWithPolicies(
      makeBook("2026-10-20"),
      [otherPolicy, revisedPolicy, oldPolicy],
    );
    expect(after.some((detection) =>
      detection.ruleId === "OVERDUE_FUNDED" &&
      detection.details.riskPolicyId === "policy-client-a-v2",
    )).toBe(true);
    expect(after).toEqual(runWatchRulesWithPolicies(
      makeBook("2026-10-20"),
      [oldPolicy, otherPolicy, revisedPolicy],
    ));
  });

  it("fails closed for absent policies, ambiguous revisions and invalid approvals", () => {
    const book = makeBook("2026-10-20");
    expect(() => runWatchRulesWithPolicies(book, [
      revisedPolicy,
      oldPolicy,
    ])).toThrow(/No approved risk policy for client client-b/);
    expect(() => runWatchRulesWithPolicies(book, [
      ...[oldPolicy, revisedPolicy, otherPolicy],
      { ...revisedPolicy, id: "duplicate-effective-date" },
    ])).toThrow(/Ambiguous/);
    expect(() => runWatchRulesWithPolicies(book, [
      oldPolicy,
      otherPolicy,
      {
        ...revisedPolicy,
        approvedAt: "2026-10-21T00:00:00Z",
      },
    ])).toThrow(/Unapproved/);
    expect(() => runWatchRulesWithPolicies(book, [
      oldPolicy,
      revisedPolicy,
      { ...otherPolicy, thresholds: {
        ...otherPolicy.thresholds,
        overdueDays: -1,
      } },
    ])).toThrow(/day threshold/);
  });

  it("enforces Auckland business-day policy boundaries across DST", () => {
    const initial = {
      ...oldPolicy,
      effectiveFrom: "2026-09-26",
      approvedAt: "2026-09-25T11:00:00Z",
    };
    const daylight = {
      ...revisedPolicy,
      effectiveFrom: "2026-09-27",
      approvedAt: "2026-09-26T11:00:00Z",
    };
    const b = makeBook("2026-09-27");
    b.creditNotes = [];
    b.fundings = b.fundings.map((f) => ({
      ...f,
      dueDate: "2026-09-10",
    }));
    expect(runWatchRulesWithPolicies(b, [
      initial,
      daylight,
      otherPolicy,
    ]).some((detection) =>
      detection.ruleId === "OVERDUE_FUNDED" &&
      detection.clientId === "client-a",
    )).toBe(true);
  });
});
