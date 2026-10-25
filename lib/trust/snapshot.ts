import type { StoredExplanation } from "@/lib/agent/stored-validation";
import { readCapturedRunEvidence } from "@/lib/agent/manifest";

import { and, desc, eq, inArray, lt, or } from "drizzle-orm";

import { buildCheckContext } from "@/lib/checks/context";
import { CHECK_CONFIG, CONFIG_VERSION } from "@/lib/checks/config";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { PROMPT_VERSION, SYSTEM_PROMPT } from "@/lib/agent/prompts";

import { canonicalJson, sha256 } from "./canonical";

export const SNAPSHOT_SCHEMA_VERSION = 3;

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
  let explanation: (StoredExplanation & { prompt: string | null }) | null =
    null;
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
  const capture = explanation
    ? await readCapturedRunEvidence(db, explanation)
    : null;
  if (capture?.status === "FAILED")
    throw Error("Bound explanation capture is invalid");
  const originalManifest = capture?.status === "PASSED" ? capture.saved : null;
  const citedIds = [
    ...new Set([
      ...(explanation?.explanation.citedEvidenceIds ?? []),
      ...(explanation?.explanation.claims.flatMap((c) => c.evidenceIds) ?? []),
    ]),
  ];
  const frozenCitedRecords =
    capture?.status === "PASSED"
      ? Object.fromEntries(
          capture.body.records
            .filter((r) => citedIds.includes(r.id))
            .map((r) => [r.id, r]),
        )
      : await citedRecords(db, citedIds);
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
    // Original agent capture stays distinct from the decision-time check inputs.
    agentEvidenceManifest: originalManifest,
    agentEvidenceSource: originalManifest
      ? "CAPTURED"
      : explanation
        ? "LEGACY_RECONSTRUCTION"
        : null,
    citedRecords: frozenCitedRecords,
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

/** Raw rows for cited ids, from every table the agent's tools can return. */
async function citedRecords(db: Db, ids: string[]) {
  if (ids.length === 0) return {};
  const out: Record<string, unknown> = {};
  const tables = [
    t.invoices,
    t.ledgerEntries,
    t.creditNotes,
    t.bankTransactions,
    t.debtorPayments,
    t.debtors,
    t.findings,
    t.fundings,
    t.fundingAdjustments,
    t.incidents,
  ] as const;
  for (const table of tables) {
    const rows = (await db
      .select()
      .from(table)
      .where(inArray(table.id, ids))) as { id: string }[];
    for (const r of rows) out[r.id] = r;
  }
  const bankIds = ids.filter(
    (id) =>
      out[id] && (out[id] as { reference?: unknown }).reference !== undefined,
  );
  if (bankIds.length > 0) {
    out.allocations = await db
      .select()
      .from(t.receiptAllocations)
      .where(inArray(t.receiptAllocations.bankTransactionId, bankIds));
  }
  return out;
}
