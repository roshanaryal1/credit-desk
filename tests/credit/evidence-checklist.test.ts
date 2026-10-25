import { describe, expect, it } from "vitest";

import {
  clientEvidenceRequirements,
  dueState,
  evidenceRequirementsForCases,
} from "@/lib/credit/evidence-checklist";
import { draftMemoFromSyntheticClient } from "@/lib/credit/memo-demo";
import { renderSyntheticMemoMarkdown } from "@/lib/credit/memo-export";
import { createMemoryDb } from "@/lib/db/client";
import { DEMO_TODAY } from "@/lib/demo";
import { listDemoCases } from "@/lib/queries/demo-cases";
import { DEV_PARAMS, generate } from "@/lib/seed/generate";
import { seedSyntheticCaseWorkboard } from "@/lib/seed/synthetic-cases";
import { writeDataset } from "@/lib/seed/write";

describe("structured fictional evidence checklist (#162)", () => {
  it("classifies due today and overdue without the wall clock", () => {
    expect(dueState("MISSING", "2026-10-20", "2026-10-20")).toBe("DUE_TODAY");
    expect(dueState("MISSING", "2026-10-19", "2026-10-20")).toBe("OVERDUE");
    expect(dueState("MISSING", "2026-10-21", "2026-10-20")).toBe("UPCOMING");
    expect(dueState("RECEIVED", "2026-10-19", "2026-10-20")).toBe("SATISFIED");
    expect(dueState("NOT_REQUIRED", null, "2026-10-20")).toBe("SATISFIED");
    expect(dueState("MISSING", null, "2026-10-20")).toBe("NO_DUE_DATE");
    expect(dueState("EXPIRED", "2026-10-19", "2026-10-20")).toBe("OVERDUE");
    expect(() => dueState("MISSING", "2026-02-30", DEMO_TODAY)).toThrow();
  });

  it("issues stable rows without inventing receipt for missing sources", () => {
    const caseRow = {
      id: "case_synthetic_01",
      clientId: "client-a",
      clientName: "Synthetic client A",
      subjectType: "INVOICE",
      subjectId: "invoice-a",
      state: "NEW",
      priority: "HIGH",
      ownerId: null,
      dueDate: "2026-10-20",
      version: 0,
    };
    const absent = evidenceRequirementsForCases(
      [caseRow],
      new Set(),
      DEMO_TODAY,
    );
    expect(absent).toHaveLength(3);
    expect(absent[0]).toMatchObject({
      state: "MISSING",
      dueState: "DUE_TODAY",
      clientId: "client-a",
      sourceId: null,
    });
    expect(absent[2]?.state).toBe("EXPIRED");
    const present = evidenceRequirementsForCases(
      [caseRow],
      new Set(["invoice-a"]),
      DEMO_TODAY,
    );
    expect(present[0]).toMatchObject({
      state: "RECEIVED",
      sourceId: "invoice-a",
      provenance: "SCOPED_LEDGER_RECORD",
    });
    expect(present.map((r) => r.id)).toEqual(absent.map((r) => r.id));
  });

  it("scopes seeded case sources by client and preserves the unsigned export", async () => {
    const db = await createMemoryDb();
    const ds = generate(DEV_PARAMS);
    await writeDataset(db, ds);
    await seedSyntheticCaseWorkboard(db, ds);
    const rows = await listDemoCases(db);
    expect(rows).toHaveLength(5);
    const clientId = rows[0]!.clientId;
    const checklist = await clientEvidenceRequirements(
      db,
      clientId,
      DEMO_TODAY,
    );
    expect(checklist.length).toBeGreaterThan(0);
    expect(checklist.every((r) => r.clientId === clientId)).toBe(true);
    expect(new Set(checklist.map((r) => r.id)).size).toBe(checklist.length);
    expect(
      checklist
        .filter((r) => r.kind === "SUBMITTED_INVOICE")
        .every((r) =>
          r.state === "RECEIVED" ? r.sourceId !== null : r.sourceId === null,
        ),
    ).toBe(true);

    const otherClient = ds.clients.find((c) => c.id !== clientId)!.id!;
    const other = await clientEvidenceRequirements(db, otherClient, DEMO_TODAY);
    expect(other.every((r) => r.clientId === otherClient)).toBe(true);
    expect(other.some((r) => checklist.some((mine) => mine.id === r.id))).toBe(
      false,
    );

    const client = ds.clients.find((c) => c.id === clientId)!;
    const memo = draftMemoFromSyntheticClient({
      id: clientId,
      name: client.name,
      facilityLimitCents: client.facilityLimitCents,
      fundsInUseCents: 0,
    });
    const exported = renderSyntheticMemoMarkdown(memo, checklist);
    expect(exported).toContain("DRAFT — ANALYST REVIEW REQUIRED");
    expect(exported).toContain("Case evidence requirements");
    expect(exported).toContain(checklist[0]!.id.replaceAll("_", "\\_"));
    expect(exported).toContain("Signed off by: NONE");
    expect(() =>
      renderSyntheticMemoMarkdown(memo, [
        {
          ...checklist[0]!,
          clientId: "someone-else",
        },
      ]),
    ).toThrow(/client-scoped/);
  }, 90_000);
});
