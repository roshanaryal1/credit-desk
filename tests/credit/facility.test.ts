import { describe, it, expect } from "vitest";
import { principalPosition, type FacilityTerms, type PrincipalMovement } from "@/lib/credit/facility";

const term: FacilityTerms={
  id:"term-1",product:"TERM",limitCents:100000,startDate:"2026-01-01",maturityDate:"2027-01-01",
};
const history: PrincipalMovement[]=[
  {id:"a",effectiveDate:"2026-01-05",action:"DRAW",amountCents:80000},
  {id:"b",effectiveDate:"2026-02-01",action:"REPAY",amountCents:30000},
];

describe("principal-only facility models", () => {
  it("lets a revolving client reborrow repaid principal", () => {
    const p=principalPosition({...term,product:"REVOLVING"},[
      ...history,{id:"c",effectiveDate:"2026-02-02",action:"DRAW",amountCents:50000},
    ],"2026-02-03");
    expect(p.outstandingCents).toBe(100000);
    expect(p.drawableHeadroomCents).toBe(0);
    expect(p.lifetimeDrawnCents).toBe(130000);
  });
  it("does not allow the term product to recycle principal", () => {
    expect(() => principalPosition(term,[
      ...history,{id:"c",effectiveDate:"2026-02-02",action:"DRAW",amountCents:50000},
    ],"2026-02-03")).toThrow(/exceeds/);
    const p=principalPosition(term,history,"2026-02-03");
    expect(p.outstandingCents).toBe(50000);
    expect(p.drawableHeadroomCents).toBe(20000);
  });
  it("keeps future payments out of earlier as-of views", () => {
    const p=principalPosition(term,history,"2026-01-31");
    expect(p.outstandingCents).toBe(80000);
    expect(p.lifetimeRepaidCents).toBe(0);
    expect(p.appliedMovementIds).toEqual(["a"]);
    expect(principalPosition(term,history,"2027-01-02").drawableHeadroomCents).toBe(0);
  });
  it("rejects overrepayment, duplicate movements, invalid dates and maturity violations", () => {
    expect(() => principalPosition(term,[history[1]!],"2026-02-03")).toThrow(/Repayment/);
    expect(() => principalPosition(term,[history[0]!,history[0]!],"2026-02-03")).toThrow(/Duplicate/);
    expect(() => principalPosition(term,[],"2026-09-31")).toThrow(/date/);
    expect(() => principalPosition(term,[{...history[0]!,effectiveDate:"2027-02-01"}],"2027-03-01")).toThrow(/maturity/);
  });
});
