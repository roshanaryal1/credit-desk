import { and, asc, desc, eq } from "drizzle-orm";

import { CHECK_CONFIG, CONFIG_VERSION } from "@/lib/checks/config";
import { buildCheckContext } from "@/lib/checks/context";
import { readCapturedRunEvidence } from "@/lib/agent/manifest";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { storedExplanationUsable } from "@/lib/agent/stored-validation";

import { loadReviewEvidence } from "./review-evidence";
import { canonicalJson, sha256 } from "./canonical";

// What an analyst is looking at when they decide. The review version is a
// hash of it; a decision submitted against an older version is rejected
// (SPEC 9.3, X12).

export async function latestExplanation(
  db: Pick<Db, "select">,
  invoiceId: string,
) {
  const [row] = await db
    .select({ explanation: t.explanations, run: t.agentRuns })
    .from(t.explanations)
    .innerJoin(t.agentRuns, eq(t.explanations.agentRunId, t.agentRuns.id))
    .where(
      and(
        eq(t.agentRuns.subjectType, "INVOICE"),
        eq(t.agentRuns.subjectId, invoiceId),
        // Only explanations written against the current check configuration
        // describe the findings on screen.
        eq(t.agentRuns.configVersion, CONFIG_VERSION),
      ),
    )
    .orderBy(desc(t.agentRuns.createdAt), desc(t.agentRuns.id))
    .limit(1);
  return row && (await storedExplanationUsable(db, row)) ? row : null;
}

export class ReviewNotFound extends Error {}

export function findingEvidenceIds(
  findings: (typeof t.findings.$inferSelect)[],
): string[] {
  return findings.flatMap((finding) => {
    const details = finding.details as { evidenceIds?: unknown };
    const ids = details?.evidenceIds;
    if (ids === undefined) return [];
    if (
      !Array.isArray(ids) ||
      !ids.every((id) => typeof id === "string" && id.length > 0)
    )
      throw Error("Invalid finding evidence");
    return ids as string[];
  });
}

/** Internal loader: its caller must supply one consistent database transaction. */
export async function loadReviewedState(
  db: Pick<Db, "select">,
  invoiceId: string,
) {
  const [panel] = await db
    .select({
      invoice: t.invoices,
      debtor: t.debtors,
      batch: t.batches,
      client: t.clients,
    })
    .from(t.invoices)
    .innerJoin(t.debtors, eq(t.invoices.debtorId, t.debtors.id))
    .innerJoin(t.batches, eq(t.invoices.batchId, t.batches.id))
    .innerJoin(t.clients, eq(t.invoices.clientId, t.clients.id))
    .where(eq(t.invoices.id, invoiceId));
  if (!panel) throw new ReviewNotFound("Invoice review not found");
  if (
    panel.debtor.clientId !== panel.invoice.clientId ||
    panel.batch.clientId !== panel.invoice.clientId
  )
    throw Error("Invoice review crosses a client boundary");
  const [context, findings, decisions] = await Promise.all([
    // The context loader only reads; the transaction supplies the same MVCC snapshot.
    buildCheckContext(db as Db, invoiceId),
    db
      .select()
      .from(t.findings)
      .where(
        and(
          eq(t.findings.invoiceId, invoiceId),
          eq(t.findings.configVersion, CONFIG_VERSION),
        ),
      )
      .orderBy(asc(t.findings.checkId), asc(t.findings.id)),
    db
      .select()
      .from(t.decisions)
      .where(eq(t.decisions.invoiceId, invoiceId))
      .orderBy(asc(t.decisions.decidedAt), asc(t.decisions.id)),
  ]);
  const explanation = await latestExplanation(db, invoiceId);
  const capture = explanation
    ? await readCapturedRunEvidence(db, explanation)
    : null;
  if (capture?.status === "FAILED")
    throw Error("Invoice evidence capture is invalid");
  const boundId = decisions[0]?.explanationIdAtDecision;
  const [boundExplanation] = boundId
    ? await db
        .select({
          recommendation: t.explanations.recommendation,
          validationStatus: t.explanations.validationStatus,
        })
        .from(t.explanations)
        .where(eq(t.explanations.id, boundId))
    : [];
  const agentIds = [
    ...new Set([
      ...(explanation?.explanation.citedEvidenceIds ?? []),
      ...(explanation?.explanation.claims.flatMap(
        (claim) => claim.evidenceIds,
      ) ?? []),
    ]),
  ];
  const evidence = await loadReviewEvidence(
    db,
    [
      ...findingEvidenceIds(findings),
      ...(capture?.status === "PASSED" ? [] : agentIds),
    ],
    panel.invoice.clientId,
  );
  const reviewed = {
    schemaVersion: 1,
    configVersion: CONFIG_VERSION,
    config: CHECK_CONFIG,
    panel,
    context,
    findings,
    decisions,
    boundExplanation: boundExplanation ?? null,
    explanation,
    agentEvidenceManifest: capture?.status === "PASSED" ? capture.saved : null,
    agentEvidenceRecords:
      capture?.status === "PASSED" ? capture.body.records : null,
    evidence,
  };
  return {
    version: sha256(canonicalJson(reviewed)),
    reviewed,
    findings,
    explanation,
    lastDecisionId: decisions.at(-1)?.id ?? null,
  };
}

export type ReviewedState = Awaited<ReturnType<typeof loadReviewedState>>;

/** Public read helper: every source and rendered fact comes from one snapshot. */
export async function reviewState(
  db: Db,
  invoiceId: string,
): Promise<ReviewedState> {
  return db.transaction((tx) => loadReviewedState(tx, invoiceId), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}
