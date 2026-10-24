import { describe, expect, it } from "vitest";

import {
  REQUIRED_DEMO_TABLES,
  assessDemoReadiness,
} from "@/lib/deploy/demo-readiness";

const ready = {
  foundTables: [...REQUIRED_DEMO_TABLES],
  clientCount: 4,
  invoiceCount: 240,
  batchCount: 8,
  findingCount: 35,
  pinnedClientFound: true,
  migrationJournalFound: true,
};

describe("read-only synthetic demo preflight", () => {
  it("requires a migrated, seeded and correctly scoped fictional borrower", () => {
    expect(assessDemoReadiness(ready)).toMatchObject({
      readyForSyntheticSmoke: true,
      failures: [],
    });
  });
  it("fails clearly on a brand-new empty hosted database", () => {
    const result = assessDemoReadiness({
      ...ready,
      foundTables: [],
      clientCount: 0,
      invoiceCount: 0,
      batchCount: 0,
      findingCount: 0,
      pinnedClientFound: false,
      migrationJournalFound: false,
    });
    expect(result.readyForSyntheticSmoke).toBe(false);
    expect(result.failures.join(" ")).toMatch(/Missing required tables/);
    expect(result.failures.join(" ")).toMatch(/Migration journal/);
  });
  it("requires nonzero findings and the pinned borrower fixture", () => {
    const result = assessDemoReadiness({
      ...ready,
      findingCount: 0,
      pinnedClientFound: false,
    });
    expect(result.readyForSyntheticSmoke).toBe(false);
    expect(result.checks.findings).toBe(false);
    expect(result.checks.fictionalClient).toBe(false);
  });
  it("rejects corrupt or unsafe counts", () => {
    for (const clientCount of [-1, NaN, Infinity, 0.5]) {
      expect(() => assessDemoReadiness({ ...ready, clientCount })).toThrow(/count/);
    }
  });
});
