import { describe, expect, it } from "vitest";

import { addDays, daysBetween, isBusinessDate } from "@/lib/dates";

describe("business calendar dates", () => {
  it("counts days across Auckland daylight-saving changes", () => {
    expect(daysBetween("2026-09-26", "2026-09-28")).toBe(2);
    expect(daysBetween("2026-04-04", "2026-04-06")).toBe(2);
  });
  it("handles leap years, year boundaries and negative offsets", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-28", 2)).toBe("2024-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(daysBetween("2026-01-02", "2025-12-31")).toBe(-2);
    expect(addDays("0099-12-31", 1)).toBe("0100-01-01");
  });
  it.each(["2026-02-29", "2026-13-01", "2026-2-01", "invalid"])(
    "rejects invalid date %s",
    (date) => {
      expect(() => daysBetween(date, "2026-10-23")).toThrow(
        "Invalid business date",
      );
    },
  );
  it("rejects fractional day arithmetic", () =>
    expect(() => addDays("2026-10-23", 0.5)).toThrow("integer"));
});

describe("untrusted business-date labels", () => {
  it.each(["2024-02-29", "2000-02-29", "2026-10-20", "0099-12-31"])(
    "accepts real date %s",
    (value) => expect(isBusinessDate(value)).toBe(true),
  );
  it.each([
    "2026-99-99",
    "2026-00-00",
    "2026-09-99",
    "2026-09-31",
    "2026-02-29",
    "1900-02-29",
    "2026-2-01",
    "2026-10-20T00:00:00Z",
    "",
    "invalid",
    null,
    undefined,
    20261020,
    ["2026-10-20"],
    {},
  ])("rejects malformed or impossible date %j without throwing", (value) => {
    expect(isBusinessDate(value)).toBe(false);
  });
});
