import { describe, expect, it } from "vitest";

import { createMemoryDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { DEMO_TODAY } from "@/lib/demo";
import {
  CASE_DEMO_TENANT,
  filterCaseWork,
  listDemoCases,
  type CaseWorkRow,
} from "@/lib/queries/demo-cases";
import { DEV_PARAMS, generate } from "@/lib/seed/generate";
import { seedSyntheticCaseWorkboard } from "@/lib/seed/synthetic-cases";
import { writeDataset } from "@/lib/seed/write";

const row = (id: string, state: string, dueDate: string | null,
  ownerId: string | null): CaseWorkRow => ({
  id, state, dueDate, ownerId,
  clientId: "c1", clientName: "Fictional",
  subjectType: "INVOICE", subjectId: "inv1",
  priority: "HIGH", version: 0,
});

describe("synthetic case workboard", () => {
  it("distinguishes unassigned, checker and actually overdue nonfinal cases", () => {
    const rows = [
      row("a", "NEW", "2026-10-19", null),
      row("b", "CHECKER_REVIEW", "2026-10-20", "maker"),
      row("c", "CLOSED", "2026-10-01", "maker"),
      row("d", "IN_REVIEW", "2026-10-18", "maker"),
    ];
    expect(filterCaseWork(rows, "unassigned", "2026-10-20").map((r) => r.id))
      .toEqual(["a"]);
    expect(filterCaseWork(rows, "checker", "2026-10-20").map((r) => r.id))
      .toEqual(["b"]);
    expect(filterCaseWork(rows, "overdue", "2026-10-20").map((r) => r.id))
      .toEqual(["d", "a"]);
    expect(rows).toHaveLength(4);
    expect(() => filterCaseWork(rows, "checker", "2026-02-30")).toThrow();
  });

  it("persists five explicitly fictional cases with maker/checker separation", async () => {
    const db = await createMemoryDb();
    const ds = generate(DEV_PARAMS);
    await writeDataset(db, ds);
    expect(await seedSyntheticCaseWorkboard(db, ds)).toBe(5);
    const all = await listDemoCases(db);
    const checking = await listDemoCases(db, "checker");
    expect(all).toHaveLength(5);
    expect(checking).toHaveLength(1);
    expect(checking[0]?.state).toBe("CHECKER_REVIEW");
    expect(all.every((r) => ds.clients.some((c) => c.id === r.clientId))).toBe(true);
    const events = await db.select().from(t.creditCaseEvents);
    expect(events).toHaveLength(5);
    expect(events.every((e) => e.action === "CREATE_DEMO_EXAMPLE")).toBe(true);
    expect(all.every((r) => r.dueDate !== null)).toBe(true);
    expect(all.some((r) => r.ownerId === null)).toBe(true);
    expect(CASE_DEMO_TENANT).toBe("creditdesk-synthetic");
  }, 90_000);

  it("does not interpret final cases as overdue", () => {
    expect(filterCaseWork([row("closed", "APPROVED", "2026-01-01", "maker")],
      "overdue", DEMO_TODAY)).toEqual([]);
  });
});
