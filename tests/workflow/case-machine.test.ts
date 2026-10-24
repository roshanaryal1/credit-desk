import { describe, expect, it } from "vitest";

import {
  transitionCase,
  type CreditCase,
  type VerifiedActor,
} from "@/lib/workflow/case-machine";

const now = "2026-10-24T08:00:00Z";
const initial: CreditCase = {
  caseId: "case-1",
  clientId: "client-1",
  state: "NEW",
  version: 0,
  ownerId: null,
  makerId: null,
  checkerId: null,
  decisionReason: null,
};
const manager: VerifiedActor = {
  subjectId: "m",
  roles: ["RISK_MANAGER"],
  clientIds: ["client-1"],
};
const analyst: VerifiedActor = {
  subjectId: "a",
  roles: ["ANALYST", "CHECKER"],
  clientIds: ["client-1"],
};
const checker: VerifiedActor = {
  subjectId: "b",
  roles: ["CHECKER"],
  clientIds: ["client-1"],
};

function submitted() {
  const assigned = transitionCase(
    initial,
    { kind: "ASSIGN", ownerId: analyst.subjectId },
    manager,
    0,
    now,
  );
  const active = transitionCase(
    assigned.next,
    { kind: "START" },
    analyst,
    1,
    now,
  );
  return transitionCase(
    active.next,
    { kind: "SUBMIT_FOR_CHECK" },
    analyst,
    2,
    now,
  );
}

describe("maker-checker case machine", () => {
  it("preserves a reviewable transition trail, without mutating input", () => {
    const submittedCase = submitted();
    expect(submittedCase.next).toMatchObject({
      state: "CHECKER_REVIEW",
      ownerId: "a",
      makerId: "a",
      version: 3,
    });
    const approved = transitionCase(
      submittedCase.next,
      { kind: "APPROVE", reason: "Evidence reviewed; no material exceptions." },
      checker,
      3,
      now,
    );
    expect(approved.next).toMatchObject({
      state: "APPROVED",
      makerId: "a",
      checkerId: "b",
      version: 4,
    });
    expect(approved.event).toMatchObject({
      from: "CHECKER_REVIEW",
      to: "APPROVED",
      actorId: "b",
      clientId: "client-1",
    });
    expect(initial.state).toBe("NEW");
    expect(submittedCase.next.state).toBe("CHECKER_REVIEW");
    expect(approved.event.reason).toMatch(/Evidence reviewed/);
  });

  it("blocks maker self-approval even if their account has CHECKER role", () => {
    const s = submitted();
    expect(() =>
      transitionCase(
        s.next,
        { kind: "APPROVE", reason: "My own credit recommendation" },
        analyst,
        3,
        now,
      ),
    ).toThrow(/different verified identities/);
  });

  it("refuses stale versions and cross-client actor access", () => {
    expect(() =>
      transitionCase(
        initial,
        { kind: "ASSIGN", ownerId: "a" },
        manager,
        5,
        now,
      ),
    ).toThrow(/Stale case version/);
    expect(() =>
      transitionCase(
        initial,
        { kind: "ASSIGN", ownerId: "a" },
        { ...manager, clientIds: ["another-client"] },
        0,
        now,
      ),
    ).toThrow(/not authorized/);
  });

  it("blocks analysts from reassignment and checkers without a review", () => {
    expect(() =>
      transitionCase(
        initial,
        { kind: "ASSIGN", ownerId: "a" },
        analyst,
        0,
        now,
      ),
    ).toThrow(/RISK_MANAGER/);
    expect(() =>
      transitionCase(
        initial,
        { kind: "APPROVE", reason: "Material risks acceptable" },
        checker,
        0,
        now,
      ),
    ).toThrow(/not awaiting checker/);
  });

  it("requires substantive checker reasons and allows controlled return", () => {
    const s = submitted();
    expect(() =>
      transitionCase(
        s.next,
        { kind: "HOLD", reason: "okay" },
        checker,
        3,
        now,
      ),
    ).toThrow(/reason/);
    const returned = transitionCase(
      s.next,
      { kind: "RETURN", reason: "Need fresh debtor receipts" },
      checker,
      3,
      now,
    );
    const resumed = transitionCase(
      returned.next,
      { kind: "START" },
      analyst,
      4,
      now,
    );
    expect(resumed.next.state).toBe("IN_REVIEW");
    expect(returned.event.reason).toBe("Need fresh debtor receipts");
  });

  it("only managers may reopen a decided case and re-clear maker/checker", () => {
    const s = submitted();
    const rejected = transitionCase(
      s.next,
      { kind: "REJECT", reason: "Invoice cannot be substantiated" },
      checker,
      3,
      now,
    );
    expect(() =>
      transitionCase(rejected.next, { kind: "REOPEN" }, checker, 4, now),
    ).toThrow(/RISK_MANAGER/);
    const reopened = transitionCase(
      rejected.next,
      { kind: "REOPEN" },
      manager,
      4,
      now,
    );
    expect(reopened.next).toMatchObject({
      state: "ASSIGNED",
      makerId: null,
      checkerId: null,
      decisionReason: null,
    });
  });
});
