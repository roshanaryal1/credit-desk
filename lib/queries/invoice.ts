import "server-only";

import { asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import type { Analyst } from "@/lib/trust/decide";
import { reviewState } from "@/lib/trust/review";

import { readCapturedRunEvidence } from "@/lib/agent/manifest";

import { resolveCapturedEvidence, resolveEvidence } from "./evidence";

/**
 * Everything the invoice panel shows. In SHADOW mode the agent's output is
 * withheld on the server until a decision exists for the invoice (SPEC 9.1).
 * Every delivery of validated agent output to a writable reviewer records
 * an exposure, including deliveries before a decision revision.
 */
export async function getInvoiceReview(
  invoiceId: string,
  analyst: Analyst,
  batchId: string,
  readOnly = false,
) {
  const db = await getDb();
  const [row] = await db
    .select({ invoice: t.invoices, debtor: t.debtors, batch: t.batches })
    .from(t.invoices)
    .innerJoin(t.debtors, eq(t.invoices.debtorId, t.debtors.id))
    .innerJoin(t.batches, eq(t.invoices.batchId, t.batches.id))
    .where(eq(t.invoices.id, invoiceId));
  // The panel only reviews invoices of the batch on screen.
  if (!row || row.invoice.batchId !== batchId) return null;

  const state = await reviewState(db, invoiceId);
  const findings = await db
    .select()
    .from(t.findings)
    .where(eq(t.findings.invoiceId, invoiceId))
    .orderBy(asc(t.findings.checkId));
  const current = findings.filter((f) =>
    state.findings.some((s) => s.id === f.id),
  );
  const decisions = await db
    .select()
    .from(t.decisions)
    .where(eq(t.decisions.invoiceId, invoiceId))
    .orderBy(asc(t.decisions.decidedAt));

  const decided = decisions.length > 0;
  // Agreement is judged against the explanation the first decision was bound to.
  const boundId = decisions[0]?.explanationIdAtDecision ?? null;
  const [bound] = boundId
    ? await db
        .select({
          recommendation: t.explanations.recommendation,
          validationStatus: t.explanations.validationStatus,
        })
        .from(t.explanations)
        .where(eq(t.explanations.id, boundId))
    : [];
  const showAgent = readOnly || analyst.mode === "ASSIST" || decided;
  const explanation = showAgent ? state.explanation : null;
  // Log delivery to a writable session even after the first decision.
  // A revision must not be classified as blind after displaying AI output.
  if (explanation && !readOnly) {
    await db
      .insert(t.exposures)
      .values({ sessionId: analyst.sessionId, invoiceId })
      .onConflictDoNothing();
  }

  const findingEvidenceIds = current.flatMap(
    (f) => (f.details as { evidenceIds?: string[] }).evidenceIds ?? [],
  );
  const capture = explanation
    ? await readCapturedRunEvidence(db, explanation)
    : null;
  // The initial guard already checked this output. A concurrent loss still fails closed.
  if (capture?.status === "FAILED") return null;
  const evidence = await resolveEvidence([
    ...findingEvidenceIds,
    ...(capture?.status === "PASSED"
      ? []
      : (explanation?.explanation.claims.flatMap((c) => c.evidenceIds) ?? [])),
  ]);
  const agentEvidence =
    capture?.status === "PASSED"
      ? resolveCapturedEvidence(capture.body.records)
      : evidence;
  const agentEvidenceSource =
    capture?.status === "PASSED" ? "CAPTURED" : "LEGACY_RECONSTRUCTION";

  return {
    invoice: row.invoice,
    debtor: row.debtor,
    batch: row.batch,
    findings: current,
    decisions,
    reviewVersion: state.version,
    hasExplanation: state.explanation !== null,
    withheld: !showAgent && state.explanation !== null,
    explanation,
    evidence,
    agentEvidence,
    agentEvidenceSource,
    boundExplanation: bound ?? null,
  };
}
