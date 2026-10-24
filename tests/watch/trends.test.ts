import { describe, expect, it } from "vitest";

import { watchTrends } from "@/lib/watch/trends";

const incidents = [
  { id: "i1", severity: "HIGH" as const, firstDetectedDate: "2026-10-01" },
  { id: "i2", severity: "MEDIUM" as const, firstDetectedDate: "2026-10-10" },
  { id: "future", severity: "HIGH" as const, firstDetectedDate: "2026-10-26" },
];
const actions = [
  { id: "res1", incidentId: "i1", status: "RESOLVED", occurredAt: new Date("2026-10-10T02:00:00Z") },
  { id: "reopen", incidentId: "i1", status: "REOPENED", occurredAt: new Date("2026-10-25T00:00:00Z") },
  { id: "future-resolve", incidentId: "i2", status: "RESOLVED", occurredAt: new Date("2026-10-25T00:00:00Z") },
];

describe("deterministic synthetic watch trends", () => {
  it("does not leak future actions or incident detections", () => {
    const before = watchTrends("2026-10-20", incidents, actions);
    expect(before).toMatchObject({
      incidentsTotal: 2,
      resolved: 1,
      unresolved: 1,
      highUnresolved: 0,
      meanResolutionSample: 1,
      meanDaysToResolution: 9,
    });
    expect(before.timeline).toHaveLength(14);
    expect(before.timeline.every((row) => row.date <= "2026-10-20")).toBe(true);
    expect(before.timeline.flatMap((row) => row.incidentIds)).not.toContain("future");
  });

  it("excludes reopened incidents from resolved completion statistics", () => {
    const after = watchTrends("2026-10-25", incidents, actions);
    expect(after.resolved).toBe(1);
    expect(after.unresolved).toBe(1);
    expect(after.highUnresolved).toBe(1);
    expect(after.meanResolutionSample).toBe(1);
  });

  it("honours NZ midnight and daylight saving business dates", () => {
    const midnight = watchTrends("2026-10-24", [
      { id: "x", severity: "LOW", firstDetectedDate: "2026-10-23" },
    ], [
      { id: "r", incidentId: "x", status: "RESOLVED", occurredAt: new Date("2026-10-24T11:00:00Z") },
    ]);
    expect(midnight.resolved).toBe(0);
    expect(midnight.unresolved).toBe(1);
  });

  it("returns unknown resolution timing when there are no resolved samples", () => {
    const result = watchTrends("2026-10-01", incidents, []);
    expect(result.meanDaysToResolution).toBeNull();
    expect(result.meanResolutionSample).toBe(0);
    expect(() => watchTrends("2026-02-30", [], [])).toThrow();
  });
});
