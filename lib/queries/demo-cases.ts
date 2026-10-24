import "server-only";

import { and, asc, eq } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { daysBetween } from "@/lib/dates";
import { DEMO_TODAY } from "@/lib/demo";

export { CASE_DEMO_TENANT } from "@/lib/queue/demo-case-tenant";
import { CASE_DEMO_TENANT } from "@/lib/queue/demo-case-tenant";
export type CaseViewFilter = "all" | "unassigned" | "checker" | "overdue";
export const CASE_FILTERS: CaseViewFilter[] = [
  "all",
  "unassigned",
  "checker",
  "overdue",
];

export interface CaseWorkRow {
  id: string;
  clientId: string;
  clientName: string;
  subjectType: string;
  subjectId: string;
  state: string;
  priority: string;
  ownerId: string | null;
  dueDate: string | null;
  version: number;
}

const FINAL = new Set(["APPROVED", "HELD", "REJECTED", "CLOSED"]);

export function filterCaseWork(
  rows: CaseWorkRow[],
  filter: CaseViewFilter,
  asOf: string,
): CaseWorkRow[] {
  daysBetween(asOf, asOf);
  if (!CASE_FILTERS.includes(filter))
    throw new Error("Unsupported case filter");
  return rows
    .filter((row) => {
      if (filter === "unassigned") return !row.ownerId && !FINAL.has(row.state);
      if (filter === "checker") return row.state === "CHECKER_REVIEW";
      if (filter === "overdue")
        return (
          row.dueDate !== null && row.dueDate < asOf && !FINAL.has(row.state)
        );
      return true;
    })
    .sort(
      (a, b) =>
        (({ HIGH: 0, MEDIUM: 1, LOW: 2 })[a.priority] ?? 3) -
          ({ HIGH: 0, MEDIUM: 1, LOW: 2 }[b.priority] ?? 3) ||
        (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") ||
        a.id.localeCompare(b.id),
    );
}

/** Scoped strictly to the disposable synthetic tenant; never real OIDC auth. */
export async function listDemoCases(
  db: Db,
  filter: CaseViewFilter = "all",
  asOf = DEMO_TODAY,
) {
  const rows = await db
    .select({
      id: t.creditCases.id,
      clientId: t.creditCases.clientId,
      clientName: t.clients.name,
      subjectType: t.creditCases.subjectType,
      subjectId: t.creditCases.subjectId,
      state: t.creditCases.state,
      priority: t.creditCases.priority,
      ownerId: t.creditCases.ownerId,
      dueDate: t.creditCases.dueDate,
      version: t.creditCases.version,
    })
    .from(t.creditCases)
    .innerJoin(t.clients, eq(t.creditCases.clientId, t.clients.id))
    .where(eq(t.creditCases.tenantId, CASE_DEMO_TENANT))
    .orderBy(asc(t.creditCases.id));
  return filterCaseWork(rows, filter, asOf);
}
