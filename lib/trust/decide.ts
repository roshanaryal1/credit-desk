import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

import { reviewState } from "./review";
import {
  SNAPSHOT_SCHEMA_VERSION,
  buildSnapshot,
  chainHead,
  hashSnapshot,
} from "./snapshot";

// Saves an analyst decision, its snapshot and an audit event in one
// transaction (SPEC 9.3, ADR 0004).

export const DecisionInputSchema = z
  .object({
    invoiceId: z.string().min(1).max(64),
    decision: z.enum(["APPROVE", "HOLD", "REJECT"]),
    reason: z.string().trim().max(1000),
    reviewVersion: z.string().regex(/^[0-9a-f]{64}$/),
    idempotencyKey: z.string().uuid(),
  })
  .refine((v) => v.decision === "APPROVE" || v.reason.length >= 5, {
    message: "A reason of at least 5 characters is required to hold or reject.",
    path: ["reason"],
  });

export type DecisionInput = z.infer<typeof DecisionInputSchema>;

export interface Analyst {
  sessionId: string;
  displayName: string;
  mode: "SHADOW" | "ASSIST";
}

export type DecideResult =
  | { ok: true; decisionId: string; duplicate: boolean }
  | { ok: false; reason: "STALE" | "NOT_FOUND"; message: string };

// Serialises snapshot-chain appends across sessions.
const CHAIN_LOCK = 4_242_001;

export async function saveDecision(
  db: Db,
  input: DecisionInput,
  analyst: Analyst,
  opts: { codeSha: string; simulated?: boolean; decidedAt?: Date },
): Promise<DecideResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${CHAIN_LOCK})`);

    const [existing] = await tx
      .select({ id: t.decisions.id })
      .from(t.decisions)
      .where(eq(t.decisions.idempotencyKey, input.idempotencyKey));
    if (existing) return { ok: true, decisionId: existing.id, duplicate: true };

    const [invoice] = await tx
      .select({ id: t.invoices.id })
      .from(t.invoices)
      .where(eq(t.invoices.id, input.invoiceId));
    if (!invoice)
      return { ok: false, reason: "NOT_FOUND", message: "Invoice not found." };

    const state = await reviewState(tx, input.invoiceId);
    if (state.version !== input.reviewVersion) {
      return {
        ok: false,
        reason: "STALE",
        message:
          "This invoice changed while you were reviewing it. Reload to see the latest findings and decisions.",
      };
    }

    const [exposure] = await tx
      .select({ at: t.exposures.exposedAt })
      .from(t.exposures)
      .where(
        sql`${t.exposures.sessionId} = ${analyst.sessionId} and ${t.exposures.invoiceId} = ${input.invoiceId}`,
      );
    const exposed = analyst.mode === "ASSIST" || exposure !== undefined;

    const id = `dec_${input.idempotencyKey.slice(0, 8)}_${input.invoiceId}`;
    const [decision] = await tx
      .insert(t.decisions)
      .values({
        id,
        invoiceId: input.invoiceId,
        decision: input.decision,
        reason: input.reason,
        analystSessionId: analyst.sessionId,
        analystDisplayName: analyst.displayName,
        mode: analyst.mode,
        explanationIdAtDecision: state.explanation?.explanation.id ?? null,
        aiContentExposedBeforeDecision: exposed,
        reviewVersion: input.reviewVersion,
        idempotencyKey: input.idempotencyKey,
        simulated: opts.simulated ?? false,
        decidedAt: opts.decidedAt ?? new Date(),
      })
      .returning();

    const snapshot = await buildSnapshot(tx as unknown as Db, {
      invoiceId: input.invoiceId,
      decision: decision!,
      codeSha: opts.codeSha,
    });
    const { text, sha256 } = hashSnapshot(snapshot);
    await tx.insert(t.decisionSnapshots).values({
      decisionId: id,
      canonicalJson: text,
      sha256,
      prevSha256: await chainHead(tx),
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      // Wall-clock time inside the lock keeps chain order and insertion order equal.
      createdAt: sql`clock_timestamp()`,
    });
    await tx.insert(t.auditEvents).values({
      id: `aud_${id}`,
      actor: `${analyst.displayName} (${analyst.sessionId.slice(0, 8)})`,
      action: `DECISION_${input.decision}`,
      entityType: "invoice",
      entityId: input.invoiceId,
      payload: {
        decisionId: id,
        mode: analyst.mode,
        simulated: opts.simulated ?? false,
        exposedBeforeDecision: exposed,
        reason: input.reason,
        findings: state.findings.map((f) => f.id),
        explanationId: state.explanation?.explanation.id ?? null,
        model: state.explanation?.run.model ?? null,
        promptVersion: state.explanation?.run.promptVersion ?? null,
        snapshotSha256: sha256,
      },
    });
    return { ok: true, decisionId: id, duplicate: false };
  });
}
