import "server-only";

import * as t from "@/lib/db/schema";
import { getDb, type Db } from "@/lib/db/client";
import type { Analyst } from "@/lib/trust/decide";
import { loadReviewedState, ReviewNotFound } from "@/lib/trust/review";
import { withSerializableRetry } from "@/lib/trust/review-transaction";
import { presentReviewEvidence, resolveCapturedEvidence } from "./evidence";

/**
 * Everything the invoice panel shows. In SHADOW mode the agent's output is
 * withheld on the server until a decision exists for the invoice (SPEC 9.1).
 * Every delivery of validated agent output records an exposure for the
 * session, including read-only views: a verified user's roles can change
 * mid-session, so a later decision must still count as exposed (#222).
 */
export async function getInvoiceReview(
  invoiceId: string,
  analyst: Analyst,
  batchId: string,
  readOnly = false,
  providedDb?: Db,
) {
  const db = providedDb ?? (await getDb());
  try {
    return await withSerializableRetry(db, async (tx) => {
      const state = await loadReviewedState(tx, invoiceId);
      const reviewed = state.reviewed;
      if (reviewed.panel.batch.id !== batchId) return null;
      const decided = reviewed.decisions.length > 0;
      const showAgent = readOnly || analyst.mode === "ASSIST" || decided;
      const explanation = showAgent ? state.explanation : null;
      if (explanation) {
        await tx
          .insert(t.exposures)
          .values({ sessionId: analyst.sessionId, invoiceId })
          .onConflictDoNothing();
      }
      const evidence = presentReviewEvidence(reviewed.evidence);
      return {
        ...reviewed.panel,
        findings: reviewed.findings,
        decisions: reviewed.decisions,
        reviewVersion: state.version,
        hasExplanation: state.explanation !== null,
        withheld: !showAgent && state.explanation !== null,
        explanation,
        evidence,
        agentEvidence:
          explanation && reviewed.agentEvidenceRecords
            ? resolveCapturedEvidence(reviewed.agentEvidenceRecords)
            : evidence,
        agentEvidenceSource: reviewed.agentEvidenceManifest
          ? "CAPTURED"
          : "LEGACY_RECONSTRUCTION",
        boundExplanation: reviewed.boundExplanation,
      };
    });
  } catch (error) {
    if (error instanceof ReviewNotFound) return null;
    throw error;
  }
}
