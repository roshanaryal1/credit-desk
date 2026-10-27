import { describe, expect, it } from "vitest";

import { clampWatchDate } from "@/lib/watch/date-filter";

describe("Watch as-of query boundary", () => {
  it.each([
    ["2026-07-22", "2026-07-22"],
    ["2026-07-23", "2026-07-23"],
    ["2026-10-19", "2026-10-19"],
    ["2026-10-20", "2026-10-20"],
    ["2026-07-21", "2026-07-22"],
    ["2024-02-29", "2026-07-22"],
    ["2026-10-21", "2026-10-20"],
    ["9999-12-31", "2026-10-20"],
  ])("maps valid date %s to %s", (input, expected) => {
    expect(clampWatchDate(input)).toBe(expected);
  });
  it.each([
    "2026-99-99",
    "2026-00-00",
    "2026-09-99",
    "2026-09-31",
    "2026-02-29",
    "2026-7-22",
    "2026-10-20T00:00:00Z",
    "",
    undefined,
    null,
    ["2026-07-22"],
    ["2026-07-22", "2026-10-19"],
  ])("falls back for invalid or repeated query %j", (input) => {
    expect(clampWatchDate(input)).toBe("2026-10-20");
  });
});
