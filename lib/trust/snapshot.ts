import { and, asc, desc, eq, gt, lt, or } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { PROMPT_VERSION, SYSTEM_PROMPT } from "@/lib/agent/prompts";
import type { ReviewedState } from "./review";
import { evidenceSubset } from "./review-evidence";
import { canonicalJson, sha256 } from "./canonical";

/**
 * v5 (#233): the digest covers the previous snapshot's hash, so rewriting a
 * snapshot also breaks the next one's digest. v1 to v4 hashed the canonical
 * JSON alone and are still verified that way.
 */
export const SNAPSHOT_SCHEMA_VERSION = 5;

/** First schema version whose digest includes the previous hash. */
const LINKED_DIGEST_VERSION = 5;

/**
 * The stored `sha256` for a snapshot. From v5 it is
 * SHA-256("v5\n" + previous hash or "" + "\n" + canonical JSON); the previous
 * hash is 64 hex characters or empty, so the framing is unambiguous.
 */
export function snapshotDigest(
  prevSha256: string | null,
  canonical: string,
  schemaVersion: number = SNAPSHOT_SCHEMA_VERSION,
): string {
  if (schemaVersion < LINKED_DIGEST_VERSION) return sha256(canonical);
  return sha256(`v${LINKED_DIGEST_VERSION}\n${prevSha256 ?? ""}\n${canonical}`);
}

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
  const checksumMatches =
    snapshotDigest(snap.prevSha256, snap.canonicalJson, snap.schemaVersion) ===
    snap.sha256;
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

/** Canonical JSON of a new snapshot and its v5 digest, linked to `prevSha256`. */
export function hashSnapshot(snapshot: unknown, prevSha256: string | null) {
  const text = canonicalJson(snapshot);
  return { text, sha256: snapshotDigest(prevSha256, text) };
}

export interface ChainBreak {
  decisionId: string;
  /** CHECKSUM: the row's digest does not match; LINK: it does not name the row before it. */
  reason: "CHECKSUM" | "LINK";
}

export interface ChainResult {
  ok: boolean;
  checked: number;
  firstBreak: ChainBreak | null;
}

const CHAIN_PAGE = 500;

type SnapshotRow = typeof t.decisionSnapshots.$inferSelect;

/**
 * Walks every snapshot in insertion order and checks each digest and each link.
 * Pages by (created_at, decision_id) so memory stays bounded as history grows.
 */
export async function verifyChain(
  db: Pick<Db, "select">,
): Promise<ChainResult> {
  let previous: string | null = null;
  let cursor: { createdAt: Date; decisionId: string } | null = null;
  let checked = 0;
  for (;;) {
    const page: SnapshotRow[] = await db
      .select()
      .from(t.decisionSnapshots)
      .where(
        cursor
          ? or(
              gt(t.decisionSnapshots.createdAt, cursor.createdAt),
              and(
                eq(t.decisionSnapshots.createdAt, cursor.createdAt),
                gt(t.decisionSnapshots.decisionId, cursor.decisionId),
              ),
            )
          : undefined,
      )
      .orderBy(
        asc(t.decisionSnapshots.createdAt),
        asc(t.decisionSnapshots.decisionId),
      )
      .limit(CHAIN_PAGE);
    for (const row of page) {
      checked += 1;
      if (row.prevSha256 !== previous)
        return {
          ok: false,
          checked,
          firstBreak: { decisionId: row.decisionId, reason: "LINK" },
        };
      if (
        snapshotDigest(row.prevSha256, row.canonicalJson, row.schemaVersion) !==
        row.sha256
      )
        return {
          ok: false,
          checked,
          firstBreak: { decisionId: row.decisionId, reason: "CHECKSUM" },
        };
      previous = row.sha256;
    }
    if (page.length < CHAIN_PAGE)
      return { ok: true, checked, firstBreak: null };
    const last: SnapshotRow = page[page.length - 1]!;
    cursor = { createdAt: last.createdAt, decisionId: last.decisionId };
  }
}
