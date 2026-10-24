import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { addDays } from "@/lib/dates";
import { DEMO_TODAY } from "@/lib/demo";
import { CASE_DEMO_TENANT } from "@/lib/queue/demo-case-tenant";
import type { Dataset } from "@/lib/seed/generate";

/** Reproducible fictional work-in-progress examples, never real approvals. */
export async function seedSyntheticCaseWorkboard(db: Db, dataset: Dataset) {
  const candidates = dataset.invoices
    .filter((invoice) =>
      dataset.labels.some(
        (label) =>
          label.invoiceId === invoice.id && label.expectedCheckIds.length > 0,
      ),
    )
    .slice(0, 5);
  const states = [
    "NEW",
    "ASSIGNED",
    "IN_REVIEW",
    "CHECKER_REVIEW",
    "RETURNED",
  ] as const;
  const recordedAt = new Date(DEMO_TODAY + "T00:00:00Z");
  for (const [index, invoice] of candidates.entries()) {
    const id = "case_synthetic_" + String(index + 1).padStart(2, "0");
    const state = states[index]!;
    const ownerId = index === 0 ? null : "fictional-analyst-a";
    await db.insert(t.creditCases).values({
      id,
      tenantId: CASE_DEMO_TENANT,
      clientId: invoice.clientId,
      subjectType: "INVOICE",
      subjectId: invoice.id,
      priority: index < 2 ? "HIGH" : "MEDIUM",
      dueDate: addDays(DEMO_TODAY, index - 2),
      state,
      version: 0,
      ownerId,
      makerId: index >= 2 ? "fictional-analyst-a" : null,
      checkerId: state === "CHECKER_REVIEW" ? "fictional-checker-b" : null,
      updatedAt: recordedAt,
    });
    await db.insert(t.creditCaseEvents).values({
      id: "cev_synthetic_" + String(index + 1).padStart(2, "0"),
      caseId: id,
      fromState: null,
      toState: state,
      version: 0,
      actorId: "synthetic-fixture",
      action: "CREATE_DEMO_EXAMPLE",
      reason: "Fictional workboard fixture only; no authenticated approval",
      occurredAt: recordedAt,
    });
  }
  return candidates.length;
}
