import { describe, expect, it } from "vitest";

import {
  proposeSimulation, transitionSimulation,
  type SyntheticAvailability,
} from "@/lib/funding/simulation";
import type { IdentityContext } from "@/lib/security/access";

const maker: IdentityContext={
  subject:"maker",tenantId:"t1",clientGrants:["c1"],roles:["ANALYST","CHECKER"],
  issuer:"oidc-test",mfaSatisfied:true,authenticatedUntilMs:2_000_000_000_000,
};
const checker: IdentityContext={...maker,subject:"checker",roles:["CHECKER"]};
const allowed: SyntheticAvailability={
  sourceId:"synthetic-worksheet",asOfDate:"2026-10-24",availableCents:20000,simulationOnly:true,
};
const now="2026-10-24T05:00:00Z";

describe("dry-run drawdown model", () => {
  const make=() => proposeSimulation({
    id:"sim-1",clientId:"c1",invoiceId:"inv-1",requestedCents:12000,availability:allowed,
  },maker,now);

  it("creates an evidence-linked intent and makes the checker independent", () => {
    const first=make();
    expect(first.intent.state).toBe("PENDING_CHECK");
    expect(first.event.action).toBe("PROPOSE");
    expect(() => transitionSimulation(first.intent,
      {kind:"APPROVE",reason:"Verified documentary evidence"},maker,1,now))
      .toThrow(/Maker/);
    const approved=transitionSimulation(first.intent,
      {kind:"APPROVE",reason:"Verified documentary evidence"},checker,1,now);
    expect(approved.intent.state).toBe("APPROVED_SIMULATION");
    const settled=transitionSimulation(approved.intent,
      {kind:"SIMULATE_SETTLEMENT",reason:"Synthetic settlement complete"},checker,2,now);
    expect(settled.intent.state).toBe("SIMULATED_SETTLED");
    expect(first.intent.state).toBe("PENDING_CHECK");
  });
  it("rejects overdraw, untrusted availability, stale version and second approval", () => {
    expect(() => proposeSimulation({
      id:"sim-2",clientId:"c1",invoiceId:"inv-2",requestedCents:25000,availability:allowed,
    },maker,now)).toThrow(/Insufficient/);
    expect(() => proposeSimulation({
      id:"sim-3",clientId:"c1",invoiceId:"inv-2",requestedCents:5000,
      availability:{...allowed,simulationOnly:false as true},
    },maker,now)).toThrow(/synthetic/);
    const first=make();
    expect(() => transitionSimulation(first.intent,
      {kind:"APPROVE",reason:"Documentary check complete"},checker,99,now)).toThrow(/Stale/);
    const approved=transitionSimulation(first.intent,
      {kind:"APPROVE",reason:"Documentary check complete"},checker,1,now);
    expect(() => transitionSimulation(approved.intent,
      {kind:"APPROVE",reason:"Documentary check complete"},checker,2,now)).toThrow(/awaiting/);
  });
  it("denies a checker without MFA or without the client grant", () => {
    const first=make();
    expect(() => transitionSimulation(first.intent,
      {kind:"APPROVE",reason:"Evidence reviewed and accepted"},
      {...checker,mfaSatisfied:false},1,now)).toThrow(/MFA_REQUIRED/);
    expect(() => transitionSimulation(first.intent,
      {kind:"APPROVE",reason:"Evidence reviewed and accepted"},
      {...checker,clientGrants:[]},1,now)).toThrow(/CLIENT_BOUNDARY/);
    expect(() => transitionSimulation(first.intent,
      {kind:"APPROVE",reason:"Evidence reviewed and accepted"},
      {...checker,tenantId:"another-tenant"},1,now)).toThrow(/TENANT_BOUNDARY/);
  });
});
