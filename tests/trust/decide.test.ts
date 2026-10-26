import { randomUUID } from "node:crypto";

import { and, eq, lte, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { runAllBatches } from "@/lib/checks/runner";
import { createMemoryDb, type Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { DEV_PARAMS, generate } from "@/lib/seed/generate";
import { writeDataset } from "@/lib/seed/write";
import { canonicalJson, sha256 } from "@/lib/trust/canonical";
import { saveDecision, type Analyst } from "@/lib/trust/decide";
import { reviewState } from "@/lib/trust/review";
import { verifySnapshot } from "@/lib/trust/snapshot";

let db: Db;
let flagged: string[];

const shadow: Analyst = {
  sessionId: "sess-a",
  displayName: "Test analyst",
  mode: "SHADOW",
};

beforeAll(async () => {
  db = await createMemoryDb();
  await writeDataset(db, generate(DEV_PARAMS));
  flagged = (await runAllBatches(db))
    .filter((r) => r.findings.length > 0)
    .map((r) => r.invoiceId);
}, 60_000);

async function decide(
  invoiceId: string,
  analyst = shadow,
  extra: Partial<{
    decision: "APPROVE" | "HOLD" | "REJECT";
    key: string;
    version: string;
  }> = {},
) {
  const version = extra.version ?? (await reviewState(db, invoiceId)).version;
  return saveDecision(
    db,
    {
      invoiceId,
      decision: extra.decision ?? "HOLD",
      reason: "Waiting for the ledger export",
      reviewVersion: version,
      idempotencyKey: extra.key ?? randomUUID(),
    },
    analyst,
    { codeSha: "test" },
  );
}

describe("canonical JSON", () => {
  it("is independent of key order and stable for hashing", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}',
    );
    expect(sha256(canonicalJson({ x: 1, y: 2 }))).toBe(
      sha256(canonicalJson({ y: 2, x: 1 })),
    );
  });
  it("encodes dates as ISO strings and drops undefined", () => {
    expect(
      canonicalJson({ at: new Date("2026-10-20T00:00:00Z"), gone: undefined }),
    ).toBe('{"at":"2026-10-20T00:00:00.000Z"}');
  });
});

describe("saving a decision", () => {
  it("writes the decision, a verifiable snapshot and an audit event together", async () => {
    const res = await decide(flagged[0]!);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [snap] = await db
      .select()
      .from(t.decisionSnapshots)
      .where(eq(t.decisionSnapshots.decisionId, res.decisionId));
    expect(snap?.sha256).toBe(sha256(snap!.canonicalJson));
    expect(await verifySnapshot(db, res.decisionId)).toEqual({
      checksumMatches: true,
      chainMatches: true,
    });
    const audit = await db
      .select()
      .from(t.auditEvents)
      .where(eq(t.auditEvents.entityId, flagged[0]!));
    expect(audit.some((a) => a.action === "DECISION_HOLD")).toBe(true);
    expect((audit[0]?.payload as { simulated?: boolean }).simulated).toBe(
      false,
    );
    const frozen = JSON.parse(snap!.canonicalJson);
    expect(frozen.checkContext.invoice.id).toBe(flagged[0]);
    expect(frozen.findings.length).toBeGreaterThan(0);
  });

  it("rejects a severed or redirected chain link", async () => {
    const a = await decide(flagged[8]!);
    const b = await decide(flagged[9]!);
    const c = await decide(flagged[10]!);
    if (!a.ok || !b.ok || !c.ok) throw new Error("expected ok");
    await db.execute(
      sql`alter table decision_snapshots disable trigger decision_snapshots_append_only`,
    );
    await db.execute(
      sql`update decision_snapshots set prev_sha256 = null where decision_id = ${c.decisionId}`,
    );
    expect((await verifySnapshot(db, c.decisionId))?.chainMatches).toBe(false);
    const [sa] = await db
      .select()
      .from(t.decisionSnapshots)
      .where(eq(t.decisionSnapshots.decisionId, a.decisionId));
    await db.execute(
      sql`update decision_snapshots set prev_sha256 = ${sa!.sha256} where decision_id = ${c.decisionId}`,
    );
    expect((await verifySnapshot(db, c.decisionId))?.chainMatches).toBe(false);
    await db.execute(
      sql`alter table decision_snapshots enable trigger decision_snapshots_append_only`,
    );
    expect((await verifySnapshot(db, b.decisionId))?.chainMatches).toBe(true);
  });

  it("chains each snapshot to the previous one", async () => {
    const a = await decide(flagged[1]!);
    const b = await decide(flagged[2]!);
    if (!a.ok || !b.ok) throw new Error("expected ok");
    const [sa] = await db
      .select()
      .from(t.decisionSnapshots)
      .where(eq(t.decisionSnapshots.decisionId, a.decisionId));
    const [sb] = await db
      .select()
      .from(t.decisionSnapshots)
      .where(eq(t.decisionSnapshots.decisionId, b.decisionId));
    expect(sb?.prevSha256).toBe(sa?.sha256);
  });

  it("saves a double submit once", async () => {
    const key = randomUUID();
    const version = (await reviewState(db, flagged[3]!)).version;
    const first = await decide(flagged[3]!, shadow, { key, version });
    const second = await decide(flagged[3]!, shadow, { key, version });
    expect(first.ok && second.ok && second.duplicate).toBe(true);
    const rows = await db
      .select()
      .from(t.decisions)
      .where(eq(t.decisions.invoiceId, flagged[3]!));
    expect(rows).toHaveLength(1);
  });

  it("rejects conflicting key reuse without returning another decision or writing history", async () => {
    const invoiceId = flagged[13]!;
    const input = {
      invoiceId,
      decision: "HOLD" as const,
      reason: "Waiting for the ledger export",
      reviewVersion: (await reviewState(db, invoiceId)).version,
      idempotencyKey: randomUUID(),
    };
    const opts = { codeSha: "test" };
    const saved = await saveDecision(db, input, shadow, opts);
    expect(saved.ok).toBe(true);
    for (const [request, actor, options] of [
      [{ ...input, invoiceId: flagged[14]! }, shadow, opts],
      [{ ...input, decision: "REJECT" as const }, shadow, opts],
      [{ ...input, reason: "Different reviewer rationale" }, shadow, opts],
      [{ ...input, reviewVersion: "0".repeat(64) }, shadow, opts],
      [input, { ...shadow, sessionId: "another-session" }, opts],
      [input, { ...shadow, displayName: "Another analyst" }, opts],
      [input, { ...shadow, mode: "ASSIST" as const }, opts],
      [input, shadow, { ...opts, simulated: true }],
      [input, shadow, { ...opts, decidedAt: new Date("2000-01-01T00:00:00Z") }],
    ] as const) {
      const result = await saveDecision(db, request, actor, options);
      expect(result).toMatchObject({ ok: false, reason: "CONFLICT" });
      expect("decisionId" in result).toBe(false);
    }
    expect(
      await db
        .select()
        .from(t.decisions)
        .where(eq(t.decisions.idempotencyKey, input.idempotencyKey)),
    ).toHaveLength(1);
    if (!saved.ok) throw new Error("expected saved decision");
    expect(
      await db
        .select()
        .from(t.decisionSnapshots)
        .where(eq(t.decisionSnapshots.decisionId, saved.decisionId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(t.auditEvents)
        .where(eq(t.auditEvents.id, `aud_${saved.decisionId}`)),
    ).toHaveLength(1);
  });

  it("rejects a decision made against an out-of-date view", async () => {
    const stale = (await reviewState(db, flagged[4]!)).version;
    await decide(flagged[4]!);
    const res = await decide(flagged[4]!, shadow, { version: stale });
    expect(res).toMatchObject({ ok: false, reason: "STALE" });
  });

  it("marks assist-mode decisions and earlier exposure as exposed", async () => {
    const assist = await decide(flagged[5]!, {
      ...shadow,
      sessionId: "sess-b",
      mode: "ASSIST",
    });
    await db
      .insert(t.exposures)
      .values({ sessionId: "sess-c", invoiceId: flagged[6]! });
    const exposedShadow = await decide(flagged[6]!, {
      ...shadow,
      sessionId: "sess-c",
    });
    if (!assist.ok || !exposedShadow.ok) throw new Error("expected ok");
    const rows = await db
      .select({
        id: t.decisions.id,
        exposed: t.decisions.aiContentExposedBeforeDecision,
      })
      .from(t.decisions)
      .where(
        sql`${t.decisions.id} in (${assist.decisionId}, ${exposedShadow.decisionId})`,
      );
    expect(rows.every((r) => r.exposed)).toBe(true);
  });

  it("detects a tampered snapshot", async () => {
    const res = await decide(flagged[7]!);
    if (!res.ok) throw new Error("expected ok");
    // Triggers block UPDATE; simulate tampering by disabling them as an admin would.
    await db.execute(
      sql`alter table decision_snapshots disable trigger decision_snapshots_append_only`,
    );
    await db.execute(
      sql`update decision_snapshots set canonical_json = replace(canonical_json, 'HOLD', 'APPROVE') where decision_id = ${res.decisionId}`,
    );
    await db.execute(
      sql`alter table decision_snapshots enable trigger decision_snapshots_append_only`,
    );
    expect((await verifySnapshot(db, res.decisionId))?.checksumMatches).toBe(
      false,
    );
  });

  it("can read the checks frozen in each snapshot", async () => {
    const res = await decide(flagged[11]!);
    if (!res.ok) throw new Error("expected ok");
    const out = await db.execute<{ checks: string[] }>(
      sql`select jsonb_path_query_array(canonical_json::jsonb, '$.findings[*].checkId') as checks from decision_snapshots where decision_id = ${res.decisionId}`,
    );
    expect(out.rows[0]?.checks.length).toBeGreaterThan(0);
  });

  it("freezes every record the explanation cites, allocated or not", async () => {
    const invoiceId = flagged[12]!;
    const [subject] = await db
      .select({ clientId: t.invoices.clientId, asOf: t.batches.submittedDate })
      .from(t.invoices)
      .innerJoin(t.batches, eq(t.invoices.batchId, t.batches.id))
      .where(eq(t.invoices.id, invoiceId));
    const [bank] = await db
      .select()
      .from(t.bankTransactions)
      .where(
        and(
          eq(t.bankTransactions.clientId, subject!.clientId),
          lte(t.bankTransactions.date, subject!.asOf),
        ),
      )
      .limit(1);
    const { CONFIG_VERSION } = await import("@/lib/checks/config");
    await db.insert(t.agentRuns).values({
      id: "run_test_cited",
      subjectType: "INVOICE",
      subjectId: invoiceId,
      provider: "test",
      model: "test",
      promptVersion: "test",
      configVersion: CONFIG_VERSION,
      codeSha: "test",
      attempts: 1,
      status: "PASSED",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
    });
    await db.insert(t.explanations).values({
      id: "exp_test_cited",
      agentRunId: "run_test_cited",
      summary: "Test.",
      riskLevel: "LOW",
      recommendation: "HOLD",
      questionsForClient: [],
      claims: [{ text: "A receipt.", evidenceIds: [bank!.id] }],
      citedEvidenceIds: [bank!.id],
      validationStatus: "PASSED",
      validationErrors: [],
    });
    const res = await decide(invoiceId);
    if (!res.ok) throw new Error("expected ok");
    const [snap] = await db
      .select()
      .from(t.decisionSnapshots)
      .where(eq(t.decisionSnapshots.decisionId, res.decisionId));
    const frozen = JSON.parse(snap!.canonicalJson);
    expect(frozen.schemaVersion).toBe(4);
    expect(frozen.citedRecords[bank!.id]).toMatchObject({
      id: bank!.id,
      amountCents: bank!.amountCents,
    });
  });

  it("requires a reason to hold or reject", async () => {
    const { DecisionInputSchema } = await import("@/lib/trust/decide");
    const base = {
      invoiceId: "x",
      reviewVersion: "a".repeat(64),
      idempotencyKey: randomUUID(),
    };
    expect(
      DecisionInputSchema.safeParse({ ...base, decision: "REJECT", reason: "" })
        .success,
    ).toBe(false);
    expect(
      DecisionInputSchema.safeParse({
        ...base,
        decision: "APPROVE",
        reason: "",
      }).success,
    ).toBe(true);
  });
});
