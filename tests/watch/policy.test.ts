import { describe, expect, it } from "vitest";

import {
  escalateIncident,
  selectRiskPolicy,
  thresholdForRule,
  type RiskPolicy,
} from "@/lib/watch/policy";

const a: RiskPolicy = {
  id: "v1",
  clientId: "c1",
  effectiveFrom: "2026-10-01",
  approvedBy: "checker-1",
  approvedAt: "2026-09-30T12:00:00Z",
  thresholds: {
    driftIncreaseDays: 15,
    overdueDays: 30,
    concentrationBps: 3000,
    facilityBps: 9000,
  },
  escalation: { mediumAfterDays: 2, highAfterDays: 5 },
};
const b: RiskPolicy = {
  ...a,
  id: "v2",
  effectiveFrom: "2026-10-20",
  approvedAt: "2026-10-19T11:00:00Z",
  thresholds: { ...a.thresholds, overdueDays: 14 },
};

describe("effective dated risk policy", () => {
  it("selects the version in force without contaminating historical dates", () => {
    expect(selectRiskPolicy([b, a], "c1", "2026-10-10")?.id).toBe("v1");
    expect(selectRiskPolicy([a, b], "c1", "2026-10-24")?.id).toBe("v2");
    expect(selectRiskPolicy([b, a], "c2", "2026-10-24")).toBeNull();
    expect(selectRiskPolicy([a], "c1", "2026-09-30")).toBeNull();
  });
  it("fails closed for conflicting versions, invalid thresholds, and backdated approvals", () => {
    expect(() =>
      selectRiskPolicy([a, { ...a, id: "other" }], "c1", "2026-10-24"),
    ).toThrow(/Ambiguous/);
    expect(() =>
      selectRiskPolicy(
        [{ ...a, thresholds: { ...a.thresholds, facilityBps: 10001 } }],
        "c1",
        "2026-10-24",
      ),
    ).toThrow(/basis-point/);
    expect(() =>
      selectRiskPolicy(
        [{ ...a, approvedAt: "2026-10-15T00:00:00Z" }],
        "c1",
        "2026-10-24",
      ),
    ).toThrow(/Unapproved/);
    expect(() => selectRiskPolicy([a], "c1", "2026-09-31")).toThrow(
      /business date/,
    );
  });
  it("escalates unresolved exceptions with stable date boundaries", () => {
    expect(escalateIncident("2026-10-20", "2026-10-21", "OPEN", a).level).toBe(
      "NONE",
    );
    expect(
      escalateIncident("2026-10-20", "2026-10-22", "ACKNOWLEDGED", a).level,
    ).toBe("MEDIUM");
    expect(escalateIncident("2026-10-20", "2026-10-25", "OPEN", a).level).toBe(
      "HIGH",
    );
    expect(
      escalateIncident("2026-10-20", "2026-10-25", "RESOLVED", a).level,
    ).toBe("NONE");
    expect(() =>
      escalateIncident("2026-10-25", "2026-10-24", "OPEN", a),
    ).toThrow(/after/);
  });
  it("uses explicit rule thresholds and does not fabricate a credit-note threshold", () => {
    expect(thresholdForRule(b, "OVERDUE_FUNDED")).toBe(14);
    expect(thresholdForRule(b, "FUNDED_CREDIT_NOTE")).toBeNull();
  });
});
