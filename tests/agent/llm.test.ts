import { describe, expect, it } from "vitest";

import { TokenBudget, retryAfterMs } from "@/lib/agent/llm";

describe("token budget", () => {
  it("waits until older spend leaves the one-minute window", () => {
    let now = 0;
    const b = new TokenBudget(1000, () => now);
    expect(b.waitFor(600)).toBe(0);
    b.record(600);
    now = 10_000;
    expect(b.waitFor(600)).toBe(50_000);
    now = 60_001;
    expect(b.waitFor(600)).toBe(0);
  });
});

describe("retry-after parsing", () => {
  it("handles seconds, HTTP dates and junk", () => {
    expect(retryAfterMs("2")).toBe(2000);
    expect(retryAfterMs(new Date(5_000).toUTCString(), 1_000)).toBe(4_000);
    expect(retryAfterMs("soon")).toBeNull();
    expect(retryAfterMs(null)).toBeNull();
  });
});
