import { and, desc, eq, inArray, lt, or } from "drizzle-orm";

import { buildCheckContext } from "@/lib/checks/context";
import { CHECK_CONFIG, CONFIG_VERSION } from "@/lib/checks/config";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { PROMPT_VERSION, SYSTEM_PROMPT } from "@/lib/agent/prompts";

import { canonicalJson, sha256 } from "./canonical";

export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface SnapshotInput {
  invoiceId: string;
  decision: typeof t.decisions.$inferSelect;
  codeSha: string;
}

/**
 * Everything needed to show a decision exactly as it was made (SPEC 9.3): the
 * full check inputs, findings, config, explanation with run metadata and
 * prompt text, the mode and exposure flag, and the decision itself.
 */
export async function buildSnapshot(db: Db, input: SnapshotInput) {
  const context = await buildCheckContext(db, input.invoiceId);
  const findings = await db
    .select()
    .from(t.findings)
    .where(
      and(
        eq(t.findings.invoiceId, input.invoiceId),
        eq(t.findings.configVersion, CONFIG_VERSION),
      ),
    )
    .orderBy(t.findings.checkId);
  let explanation = null;
  if (input.decision.explanationIdAtDecision) {
    const [row] = await db
      .select({ explanation: t.explanations, run: t.agentRuns })
      .from(t.explanations)
      .innerJoin(t.agentRuns, eq(t.explanations.agentRunId, t.agentRuns.id))
      .where(eq(t.explanations.id, input.decision.explanationIdAtDecision));
    explanation = row
      ? {
          ...row,
          prompt:
            row.run.promptVersion === PROMPT_VERSION ? SYSTEM_PROMPT : null,
        }
      : null;
  }
  const allocations = context.receiptAllocations;
  const bankIds = allocations.map((a) => a.bankTransactionId);
  const bankLines = bankIds.length
    ? await db
        .select()
        .from(t.bankTransactions)
        .where(inArray(t.bankTransactions.id, bankIds))
    : [];
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    codeSha: input.codeSha,
    configVersion: CONFIG_VERSION,
    config: CHECK_CONFIG,
    checkContext: context,
    findings,
    bankLines,
    explanation,
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
