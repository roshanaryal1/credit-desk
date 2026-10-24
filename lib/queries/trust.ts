import "server-only";

import { asc, eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import type { DecisionRecord, Recommendation } from "@/lib/trust/agreement";
import { verifySnapshot } from "@/lib/trust/snapshot";

/** All decisions as agreement records, in decision order. */
export async function decisionRecords(): Promise<DecisionRecord[]> {
  const db = await getDb();
  const rows = await db
    .select({ d: t.decisions, e: t.explanations })
    .from(t.decisions)
    .leftJoin(
      t.explanations,
      eq(t.decisions.explanationIdAtDecision, t.explanations.id),
    )
    .orderBy(asc(t.decisions.decidedAt), asc(t.decisions.id));
  // Checks come from each decision's frozen snapshot, so re-running checks
  // under a new config can never move historical decisions between groups.
  const frozen = await db.execute<{ decision_id: string; checks: string[] }>(
    sql`select decision_id, jsonb_path_query_array(canonical_json::jsonb, '$.findings[*].checkId') as checks from decision_snapshots`,
  );
  const checksByDecision = new Map(
    frozen.rows.map((r) => [r.decision_id, r.checks]),
  );
  const seen = new Map<string, number>();
  return rows.map(({ d, e }) => {
    const prior = seen.get(d.invoiceId) ?? 0;
    seen.set(d.invoiceId, prior + 1);
    return {
      decisionId: d.id,
      invoiceId: d.invoiceId,
      decision: d.decision,
      mode: d.mode,
      exposed: d.aiContentExposedBeforeDecision,
      simulated: d.simulated,
      decidedAt: d.decidedAt.toISOString(),
      priorDecisions: prior,
      recommendation: (e?.recommendation as Recommendation | undefined) ?? null,
      explanationPassed: e?.validationStatus === "PASSED",
      riskLevel: e?.riskLevel ?? null,
      checks: checksByDecision.get(d.id) ?? [],
    };
  });
}

/** A stored snapshot, parsed, with its checksum and chain verification. */
export async function loadReplay(decisionId: string) {
  const db = await getDb();
  const [snap] = await db
    .select()
    .from(t.decisionSnapshots)
    .where(eq(t.decisionSnapshots.decisionId, decisionId));
  if (!snap) return null;
  const verification = await verifySnapshot(db, decisionId);
  return {
    snap,
    verification: verification!,
    frozen: JSON.parse(snap.canonicalJson) as FrozenSnapshot,
  };
}

export interface FrozenSnapshot {
  schemaVersion: number;
  codeSha: string;
  configVersion: string;
  config: Record<string, unknown>;
  checkContext: {
    invoice: {
      id: string;
      invoiceNumber: string;
      amountCents: number;
      issueDate: string;
      dueDate: string;
      debtorId: string;
      clientId: string;
    };
    submittedDate: string;
    ledgerEntry: null | {
      id: string;
      amountCents: number;
      status: string | null;
      creditNotes: { id: string; date: string; amountCents: number }[];
    };
    receiptAllocations: {
      bankTransactionId: string;
      amountCents: number;
      bankTransaction: { date: string };
    }[];
  };
  findings: { id: string; checkId: string; severity: string }[];
  explanation: null | {
    explanation: {
      id: string;
      summary: string;
      recommendation: string;
      riskLevel: string;
      claims: { text: string; evidenceIds: string[] }[];
      validationStatus: string;
    };
    run: { model: string; promptVersion: string; provider: string };
  };
  decision: {
    id: string;
    decision: string;
    reason: string;
    mode: string;
    analystDisplayName: string;
    decidedAt: string;
    aiContentExposedBeforeDecision: boolean;
    simulated: boolean;
  };
}

/** Differences between a frozen snapshot and live data for the same invoice. */
export async function changesSince(frozen: FrozenSnapshot): Promise<string[]> {
  const db = await getDb();
  const changes: string[] = [];
  const invoiceId = frozen.checkContext.invoice.id;
  const ledgerId = frozen.checkContext.ledgerEntry?.id;
  const { businessDate, money } = await import("@/lib/format");
  if (ledgerId) {
    const known = new Set(
      frozen.checkContext.ledgerEntry!.creditNotes.map((c) => c.id),
    );
    const notes = await db
      .select()
      .from(t.creditNotes)
      .where(eq(t.creditNotes.ledgerEntryId, ledgerId));
    for (const n of notes.filter((n) => !known.has(n.id))) {
      changes.push(
        `A credit note of ${money(n.amountCents)} dated ${businessDate(n.date)} was added.`,
      );
    }
    const statuses = await db
      .select()
      .from(t.ledgerStatusEvents)
      .where(eq(t.ledgerStatusEvents.ledgerEntryId, ledgerId));
    const later = statuses.filter(
      (s) => s.effectiveDate > frozen.checkContext.submittedDate,
    );
    for (const s of later)
      changes.push(
        `The ledger status became ${s.status.toLowerCase()} on ${businessDate(s.effectiveDate)}.`,
      );
  }
  const decisions = await db
    .select()
    .from(t.decisions)
    .where(eq(t.decisions.invoiceId, invoiceId))
    .orderBy(asc(t.decisions.decidedAt));
  const after = decisions.filter(
    (d) => d.decidedAt.toISOString() > frozen.decision.decidedAt,
  );
  for (const d of after)
    changes.push(
      `A later decision (${d.decision.toLowerCase()}) was recorded by ${d.analystDisplayName}.`,
    );
  const findings = await db
    .select()
    .from(t.findings)
    .where(eq(t.findings.invoiceId, invoiceId));
  const frozenIds = new Set(frozen.findings.map((f) => f.id));
  for (const f of findings.filter(
    (f) => !frozenIds.has(f.id) && f.configVersion !== frozen.configVersion,
  )) {
    changes.push(
      `Check ${f.checkId} was re-run under config ${f.configVersion}.`,
    );
  }
  return changes;
}
