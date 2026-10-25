import { describe, expect, it } from "vitest";

import { createMemoryDb } from "@/lib/db/client";
import { DEMO_TODAY } from "@/lib/demo";
import { listDemoCases, type CaseWorkRow } from "@/lib/queries/demo-cases";
import { DEV_PARAMS, generate } from "@/lib/seed/generate";
import { seedSyntheticCaseWorkboard } from "@/lib/seed/synthetic-cases";
import { writeDataset } from "@/lib/seed/write";
import {
  classifyCaseSla,
  elapsedBusinessDays,
  syntheticCaseSlaQueue,
  SYNTHETIC_SLA_POLICY,
} from "@/lib/workflow/case-sla";

const caseRow: CaseWorkRow = {
  id: "case-demo-1",
  clientId: "client-demo",
  clientName: "Synthetic Borrower",
  subjectType: "INVOICE",
  subjectId: "invoice-demo",
  state: "IN_REVIEW",
  priority: "HIGH",
  ownerId: "fictional-analyst",
  dueDate: "2026-10-23",
  version: 4,
};

describe("case SLA business-day calculation (#105)", () => {
  it("counts NZ date labels, not wall-clock hours across weekends and daylight saving", () => {
    expect(elapsedBusinessDays("2026-10-23", "2026-10-23")).toBe(0);
    expect(elapsedBusinessDays("2026-10-23", "2026-10-24")).toBe(0);
    expect(elapsedBusinessDays("2026-10-23", "2026-10-25")).toBe(0);
    expect(elapsedBusinessDays("2026-10-23", "2026-10-26")).toBe(1);
    expect(elapsedBusinessDays("2026-10-23", "2026-10-28")).toBe(3);
    expect(elapsedBusinessDays("2026-09-25", "2026-09-28")).toBe(1);
    expect(elapsedBusinessDays("2026-10-26", "2026-10-23")).toBe(0);
    expect(
      elapsedBusinessDays("2026-10-23", "2026-10-26", new Set(["2026-10-26"])),
    ).toBe(0);
  });

  it("preserves final states and missing deadlines as explicit non-breach states", () => {
    expect(
      classifyCaseSla(
        {
          ...caseRow,
          state: "APPROVED",
          dueDate: "2026-10-01",
        },
        "2026-10-27",
      ),
    ).toMatchObject({
      stage: "CLOSED",
      noticeCandidate: null,
    });
    expect(
      classifyCaseSla(
        {
          ...caseRow,
          dueDate: null,
        },
        "2026-10-27",
      ),
    ).toMatchObject({
      stage: "NO_DEADLINE",
      noticeCandidate: null,
    });
    expect(classifyCaseSla(caseRow, "2026-10-23").stage).toBe("DUE_TODAY");
    expect(classifyCaseSla(caseRow, "2026-10-24").stage).toBe(
      "NONWORKING_DAY_GRACE",
    );
    expect(classifyCaseSla(caseRow, "2026-10-26").stage).toBe("BREACHED");
    expect(classifyCaseSla(caseRow, "2026-10-28").stage).toBe("CRITICAL");
  });

  it("requires explicit holiday calendar for production-specific dates and stable notice candidates", () => {
    const unapproved = classifyCaseSla(caseRow, "2026-10-26");
    const supplied = classifyCaseSla(caseRow, "2026-10-26", {
      ...SYNTHETIC_SLA_POLICY,
      holidays: ["2026-10-26"],
      version: "fictional-calendar-v2",
    });
    expect(unapproved.calendarEvidence).toBe("WEEKDAYS_ONLY");
    expect(supplied).toMatchObject({
      stage: "NONWORKING_DAY_GRACE",
      businessDaysLate: 0,
      calendarEvidence: "INJECTED_HOLIDAYS",
      noticeCandidate: null,
    });
    const again = classifyCaseSla(caseRow, "2026-10-27");
    expect(again.noticeCandidate).toBe(unapproved.noticeCandidate);
    expect(
      classifyCaseSla(
        {
          ...caseRow,
          version: 5,
        },
        "2026-10-27",
      ).noticeCandidate,
    ).not.toBe(unapproved.noticeCandidate);
    expect(classifyCaseSla(caseRow, "2026-10-28").noticeCandidate).not.toBe(
      unapproved.noticeCandidate,
    );
  });

  it("rejects invalid policies, calendars, versions and unsupported time windows", () => {
    expect(() =>
      classifyCaseSla(caseRow, "2026-10-26", {
        ...SYNTHETIC_SLA_POLICY,
        criticalBusinessDays: 0,
      }),
    ).toThrow(/policy/);
    expect(() =>
      classifyCaseSla(caseRow, "2026-10-26", {
        ...SYNTHETIC_SLA_POLICY,
        holidays: ["2026-10-26", "2026-10-26"],
      }),
    ).toThrow(/Duplicate/);
    expect(() =>
      classifyCaseSla(caseRow, "2026-10-26", {
        ...SYNTHETIC_SLA_POLICY,
        holidays: ["2026-02-30"],
      }),
    ).toThrow(/business date/);
    expect(() => classifyCaseSla(caseRow, "2026-02-30")).toThrow();
    expect(() =>
      classifyCaseSla(
        {
          ...caseRow,
          version: -1,
        },
        "2026-10-26",
      ),
    ).toThrow(/identity/);
    expect(() => elapsedBusinessDays("2010-01-01", "2026-10-26")).toThrow(
      /large/,
    );
  });

  it("maps only seeded fictional case rows without creating any decisions", async () => {
    const db = await createMemoryDb();
    const ds = generate(DEV_PARAMS);
    await writeDataset(db, ds);
    await seedSyntheticCaseWorkboard(db, ds);
    const sourceRows = await listDemoCases(db, "all", DEMO_TODAY);
    const projected = syntheticCaseSlaQueue(sourceRows, DEMO_TODAY);
    expect(projected.length).toBe(sourceRows.length);
    expect(
      projected.every((r) =>
        sourceRows.some((s) => s.id === r.caseId && s.clientId === r.clientId),
      ),
    ).toBe(true);
    expect(projected.every((r) => r.calendarEvidence === "WEEKDAYS_ONLY")).toBe(
      true,
    );
    expect(syntheticCaseSlaQueue(sourceRows, DEMO_TODAY)).toEqual(projected);
    const finalCases = await listDemoCases(db, "all", DEMO_TODAY);
    expect(finalCases).toEqual(sourceRows);
  }, 90_000);
});
