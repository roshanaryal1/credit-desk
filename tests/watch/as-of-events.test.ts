import { describe, expect, it } from "vitest";

import {
  incidentEventsAsOf,
  nzBusinessDateAt,
} from "@/lib/watch/as-of-events";

const event = (id: string, iso: string) => ({
  id,
  occurredAt: new Date(iso),
});

describe("NZ-local historic incident status", () => {
  it.each([
    ["2026-10-24T10:59:59Z", "2026-10-24"],
    ["2026-10-24T11:00:00Z", "2026-10-25"],
    ["2026-06-24T11:59:59Z", "2026-06-24"],
    ["2026-06-24T12:00:00Z", "2026-06-25"],
    ["2026-09-26T13:59:59Z", "2026-09-27"],
    ["2026-09-26T14:00:00Z", "2026-09-27"],
  ])("maps %s to the correct NZ day", (instant, expected) => {
    expect(nzBusinessDateAt(new Date(instant))).toBe(expected);
  });

  it("excludes future resolution and reopen actions in a historic replay", () => {
    const events = [
      event("reopened", "2026-10-25T00:30:00Z"),
      event("resolved", "2026-10-24T12:00:00Z"),
      event("acknowledged", "2026-10-24T10:30:00Z"),
    ];
    expect(incidentEventsAsOf(events, "2026-10-24").map((e) => e.id)).toEqual([
      "acknowledged",
    ]);
    expect(incidentEventsAsOf(events, "2026-10-25").map((e) => e.id)).toEqual([
      "acknowledged",
      "resolved",
      "reopened",
    ]);
    expect(events[0]?.id).toBe("reopened");
  });

  it("fails closed for malformed dates or timestamps", () => {
    expect(() => incidentEventsAsOf([], "2026-02-30")).toThrow(/business date/);
    expect(() => nzBusinessDateAt(new Date("not an instant"))).toThrow(
      /instant/,
    );
  });
});
