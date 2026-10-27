import { and, desc, eq, lt, or } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { PROMPT_VERSION, SYSTEM_PROMPT } from "@/lib/agent/prompts";
import type { ReviewedState } from "./review";
import { evidenceSubset } from "./review-evidence";
import { canonicalJson, sha256 } from "./canonical";

export const SNAPSHOT_SCHEMA_VERSION = 4;

export interface SnapshotInput {
  invoiceId: string;
  decision: typeof t.decisions.$inferSelect;
  codeSha: string;
}

/** Pure freezing: never re-fetch sources after the reviewed version is checked. */
export function buildSnapshot(state: ReviewedState, input: SnapshotInput) {
  const reviewed = state.reviewed;
  if (
    reviewed.panel.invoice.id !== input.invoiceId ||
    input.decision.invoiceId !== input.invoiceId ||
    input.decision.reviewVersion !== state.version ||
    input.decision.explanationIdAtDecision !==
      (state.explanation?.explanation.id ?? null)
  )
    throw Error("Decision does not match reviewed state");
  const explanation = reviewed.explanation
    ? {
        ...reviewed.explanation,
        prompt:
          reviewed.explanation.run.promptVersion === PROMPT_VERSION
            ? SYSTEM_PROMPT
            : null,
      }
    : null;
  const ids = [
    ...new Set([
      ...(explanation?.explanation.citedEvidenceIds ?? []),
      ...(explanation?.explanation.claims.flatMap(
        (claim) => claim.evidenceIds,
      ) ?? []),
    ]),
  ];
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    codeSha: input.codeSha,
    configVersion: reviewed.configVersion,
    config: reviewed.config,
    checkContext: reviewed.context,
    findings: reviewed.findings,
    bankLines: [
      ...new Map(
        reviewed.context.receiptAllocations.map((allocation) => [
          allocation.bankTransaction.id,
          allocation.bankTransaction,
        ]),
      ).values(),
    ].sort((a, b) => a.id.localeCompare(b.id)),
    explanation,
    agentEvidenceManifest: reviewed.agentEvidenceManifest,
    agentEvidenceSource: reviewed.agentEvidenceManifest
      ? "CAPTURED"
      : explanation
        ? "LEGACY_RECONSTRUCTION"
        : null,
    citedRecords: reviewed.agentEvidenceRecords
      ? Object.fromEntries(
          reviewed.agentEvidenceRecords
            .filter((record) => ids.includes(record.id))
            .map((record) => [record.id, record]),
        )
      : evidenceSubset(reviewed.evidence, ids),
    reviewedState: reviewed,
    reviewedStateSha256: state.version,
    decision: input.decision,
  };
}

/** The previous snapshot in the chain, ordered by insertion. */
export async function chainHead(db: Pick<Db, "select">) {
  const [row] = await db
    .select({ sha256: t.decisionSnapshots.sha256 })
    .from(t.decisionSnapshots)
    .orderBy(
      desc(t.decisionSnapshots.createdAt),
      desc(t.decisionSnapshots.decisionId),
    )
    .limit(1);
  return row?.sha256 ?? null;
}

export interface VerifyResult {
  checksumMatches: boolean;
  chainMatches: boolean;
}

/** Recomputes the hash of a stored snapshot and checks its link to the previous one. */
export async function verifySnapshot(
  db: Pick<Db, "select">,
  decisionId: string,
): Promise<VerifyResult | null> {
  const [snap] = await db
    .select()
    .from(t.decisionSnapshots)
    .where(eq(t.decisionSnapshots.decisionId, decisionId));
  if (!snap) return null;
  const checksumMatches = sha256(snap.canonicalJson) === snap.sha256;
  // The link must name the snapshot inserted immediately before this one;
  // null is only valid for the first snapshot in the chain.
  const [prev] = await db
    .select({ sha256: t.decisionSnapshots.sha256 })
    .from(t.decisionSnapshots)
    .where(
      or(
        lt(t.decisionSnapshots.createdAt, snap.createdAt),
        and(
          eq(t.decisionSnapshots.createdAt, snap.createdAt),
          lt(t.decisionSnapshots.decisionId, snap.decisionId),
        ),
      ),
    )
    .orderBy(
      desc(t.decisionSnapshots.createdAt),
      desc(t.decisionSnapshots.decisionId),
    )
    .limit(1);
  const chainMatches = (prev?.sha256 ?? null) === snap.prevSha256;
  return { checksumMatches, chainMatches };
}

export function hashSnapshot(snapshot: unknown) {
  const text = canonicalJson(snapshot);
  return { text, sha256: sha256(text) };
}
