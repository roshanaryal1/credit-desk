import { count } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { runAllBatches } from "@/lib/checks/runner";
import { createMemoryDb, type Db } from "@/lib/db/client";
import { findings } from "@/lib/db/schema";
import { DEV_PARAMS, generate } from "@/lib/seed/generate";
import { writeDataset } from "@/lib/seed/write";

let db: Db;

beforeAll(async () => {
  db = await createMemoryDb();
  await writeDataset(db, generate(DEV_PARAMS));
}, 60_000);

describe("batch runner", () => {
  it("stores findings once per invoice, check and config version", async () => {
    const first = await runAllBatches(db);
    const [a] = await db.select({ n: count() }).from(findings);
    await runAllBatches(db);
    const [b] = await db.select({ n: count() }).from(findings);
    const expected = first.reduce((sum, r) => sum + r.findings.length, 0);
    expect(a?.n).toBe(expected);
    expect(b?.n).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  }, 60_000);
});
