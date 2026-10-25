import { and, eq, inArray, lte } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { daysBetween } from "@/lib/dates";
import { listDemoCases, type CaseWorkRow } from "@/lib/queries/demo-cases";

export type RequirementState =
  "MISSING" | "RECEIVED" | "EXPIRED" | "NOT_REQUIRED";
export type DueState =
  "OVERDUE" | "DUE_TODAY" | "UPCOMING" | "SATISFIED" | "NO_DUE_DATE";

export interface EvidenceRequirement {
  id: string;
  caseId: string;
  clientId: string;
  kind: "SUBMITTED_INVOICE" | "BANK_CONFIRMATION" | "DEBTOR_CONSENT";
  label: string;
  dueDate: string | null;
  state: RequirementState;
  dueState: DueState;
  sourceId: string | null;
  sourceHref: string | null;
  provenance: "SYNTHETIC_FIXTURE" | "SCOPED_LEDGER_RECORD";
}

export function dueState(
  state: RequirementState,
  dueDate: string | null,
  asOf: string,
): DueState {
  daysBetween(asOf, asOf);
  if (dueDate === null)
    return state === "MISSING" ? "NO_DUE_DATE" : "SATISFIED";
  daysBetween(dueDate, dueDate);
  if (state === "RECEIVED" || state === "NOT_REQUIRED") return "SATISFIED";
  if (state === "EXPIRED") return "OVERDUE";
  return dueDate < asOf
    ? "OVERDUE"
    : dueDate === asOf
      ? "DUE_TODAY"
      : "UPCOMING";
}

/**
 * Stable fictional checklist metadata. The submitted invoice is marked
 * RECEIVED *only* when the existing ledger evidence is present in the
 * same client and dated batch; all other statuses are visibly demo fixtures.
 * No persisted authoritative document or approval is invented.
 */
export function evidenceRequirementsForCases(
  rows: readonly CaseWorkRow[],
  verifiedInvoiceIds: ReadonlySet<string>,
  asOf: string,
): EvidenceRequirement[] {
  daysBetween(asOf, asOf);
  const output: EvidenceRequirement[] = [];
  for (const row of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
    const received =
      row.subjectType === "INVOICE" && verifiedInvoiceIds.has(row.subjectId);
    const template: Array<{
      kind: EvidenceRequirement["kind"];
      label: string;
      state: RequirementState;
      sourceId: string | null;
      sourceHref: string | null;
      provenance: EvidenceRequirement["provenance"];
    }> = [
      {
        kind: "SUBMITTED_INVOICE",
        label: "Submitted invoice record (not authenticated by borrower)",
        state: received ? "RECEIVED" : "MISSING",
        sourceId: received ? row.subjectId : null,
        sourceHref: received ? "/batches" : null,
        provenance: received ? "SCOPED_LEDGER_RECORD" : "SYNTHETIC_FIXTURE",
      },
      {
        kind: "BANK_CONFIRMATION",
        label: "Independent bank receipt confirmation",
        state: "MISSING",
        sourceId: null,
        sourceHref: null,
        provenance: "SYNTHETIC_FIXTURE",
      },
      {
        kind: "DEBTOR_CONSENT",
        label: "Fictional debtor consent review",
        // An intentionally expired metadata example; NOT a real document.
        state:
          row.id === "case_synthetic_01"
            ? "EXPIRED"
            : row.state === "CHECKER_REVIEW"
              ? "MISSING"
              : "NOT_REQUIRED",
        sourceId: null,
        sourceHref: null,
        provenance: "SYNTHETIC_FIXTURE",
      },
    ];
    for (const field of template) {
      const state = field.state;
      output.push({
        id: row.id + ":" + field.kind,
        caseId: row.id,
        clientId: row.clientId,
        kind: field.kind,
        label: field.label,
        dueDate: row.dueDate,
        state,
        dueState: dueState(state, row.dueDate, asOf),
        sourceId: field.sourceId,
        sourceHref: field.sourceHref,
        provenance: field.provenance,
      });
    }
  }
  return output;
}

/** Read the synthetic case tenant only, then prove source invoice client/date. */
export async function clientEvidenceRequirements(
  db: Db,
  clientId: string,
  asOf: string,
): Promise<EvidenceRequirement[]> {
  daysBetween(asOf, asOf);
  const rows = (await listDemoCases(db, "all", asOf)).filter(
    (row) => row.clientId === clientId,
  );
  if (!rows.length) return [];
  const ids = rows
    .filter((row) => row.subjectType === "INVOICE")
    .map((row) => row.subjectId);
  const verified = ids.length
    ? await db
        .select({ id: t.invoices.id })
        .from(t.invoices)
        .innerJoin(t.batches, eq(t.invoices.batchId, t.batches.id))
        .where(
          and(
            eq(t.invoices.clientId, clientId),
            inArray(t.invoices.id, ids),
            lte(t.batches.submittedDate, asOf),
          ),
        )
    : [];
  return evidenceRequirementsForCases(
    rows,
    new Set(verified.map((v) => v.id)),
    asOf,
  );
}
