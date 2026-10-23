import { describe, expect, it } from "vitest";

import { createMemoryDb } from "@/lib/db/client";
import { takeAll } from "@/lib/rate-limit";

describe("rate limits", () => {
  it("admits exactly the limit under concurrent requests", async () => {
    const db = await createMemoryDb();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        takeAll(db, [{ key: "rerun:session:s1", max: 10, windowMs: 60_000 }]),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(10);
  });

  it("records nothing when any key is over its limit", async () => {
    const db = await createMemoryDb();
    for (let i = 0; i < 2; i++)
      await takeAll(db, [{ key: "global", max: 2, windowMs: 60_000 }]);
    const ok = await takeAll(db, [
      { key: "global", max: 2, windowMs: 60_000 },
      { key: "session", max: 10, windowMs: 60_000 },
    ]);
    expect(ok).toBe(false);
    // The session key was not charged for the refused request.
    const again = await takeAll(db, [
      { key: "session", max: 1, windowMs: 60_000 },
    ]);
    expect(again).toBe(true);
  });
});
