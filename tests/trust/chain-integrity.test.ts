import { randomUUID } from "node:crypto";

import { asc, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { runAllBatches } from "@/lib/checks/runner";
import { createMemoryDb, type Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { DEV_PARAMS, generate } from "@/lib/seed/generate";
import { writeDataset } from "@/lib/seed/write";
import { sha256 } from "@/lib/trust/canonical";
import { saveDecision, type Analyst } from "@/lib/trust/decide";
import { reviewState } from "@/lib/trust/review";
import {
  SNAPSHOT_SCHEMA_VERSION,
  snapshotDigest,
  verifyChain,
  verifySnapshot,
} from "@/lib/trust/snapshot";

// Issue #233: the snapshot hash must cover the previous hash, so rewriting a
// snapshot and the next snapshot's link is detected.

let db: Db;
let flagged: string[];

const analyst: Analyst = {
  sessionId: "sess-chain",
  displayName: "Chain analyst",
  mode: "SHADOW",
};

beforeAll(async () => {
  db = await createMemoryDb();
  await writeDataset(db, generate(DEV_PARAMS));
  flagged = (await runAllBatches(db))
    .filter((r) => r.findings.length > 0)
    .map((r) => r.invoiceId);
}, 60_000);

async function decide(invoiceId: string) {
  const res = await saveDecision(
    db,
    {
      invoiceId,
      decision: "HOLD",
      reason: "Waiting for the ledger export",
      reviewVersion: (await reviewState(db, invoiceId)).version,
      idempotencyKey: randomUUID(),
    },
    analyst,
    { codeSha: "test" },
  );
  if (!res.ok) throw new Error(`expected ok, got ${res.reason}`);
  return res.decisionId;
}

async function snapshot(decisionId: string) {
  const [row] = await db
    .select()
    .from(t.decisionSnapshots)
    .where(eq(t.decisionSnapshots.decisionId, decisionId));
  return row!;
}

async function asAdmin(run: () => Promise<unknown>) {
  // Triggers block UPDATE; an attacker with database access can disable them.
  await db.execute(
    sql`alter table decision_snapshots disable trigger decision_snapshots_append_only`,
  );
  try {
    await run();
  } finally {
    await db.execute(
      sql`alter table decision_snapshots enable trigger decision_snapshots_append_only`,
    );
  }
}

describe("snapshot chain (#233)", () => {
  it("hashes the previous hash together with the canonical JSON", async () => {
    const a = await decide(flagged[0]!);
    const b = await decide(flagged[1]!);
    const sa = await snapshot(a);
    const sb = await snapshot(b);
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(5);
    expect(sb.schemaVersion).toBe(5);
    expect(sb.prevSha256).toBe(sa.sha256);
    expect(sb.sha256).toBe(snapshotDigest(sb.prevSha256, sb.canonicalJson));
    expect(sb.sha256).not.toBe(sha256(sb.canonicalJson));
    expect(await verifySnapshot(db, b)).toEqual({
      checksumMatches: true,
      chainMatches: true,
    });
    expect(await verifyChain(db)).toMatchObject({ ok: true });
  });

  it("detects a rewritten snapshot whose successor's link was rewritten too", async () => {
    const n = await decide(flagged[2]!);
    const next = await decide(flagged[3]!);
    const sn = await snapshot(n);
    // Rewrite N with a recomputed digest, then repoint N+1 at the new hash.
    // Under v4 both rows verified; the link is now inside N+1's digest.
    const forged = sn.canonicalJson.replace('"HOLD"', '"APPROVE"');
    expect(forged).not.toBe(sn.canonicalJson);
    const forgedSha = snapshotDigest(sn.prevSha256, forged);
    await asAdmin(async () => {
      await db.execute(
        sql`update decision_snapshots set canonical_json = ${forged}, sha256 = ${forgedSha} where decision_id = ${n}`,
      );
      await db.execute(
        sql`update decision_snapshots set prev_sha256 = ${forgedSha} where decision_id = ${next}`,
      );
    });
    expect((await verifySnapshot(db, n))?.checksumMatches).toBe(true);
    expect(await verifySnapshot(db, next)).toEqual({
      checksumMatches: false,
      chainMatches: true,
    });
    const chain = await verifyChain(db);
    expect(chain.ok).toBe(false);
    expect(chain.firstBreak).toMatchObject({
      decisionId: next,
      reason: "CHECKSUM",
    });
  });

  it("refuses a fork: two snapshots may not share a previous hash", async () => {
    const rows = await db
      .select()
      .from(t.decisionSnapshots)
      .orderBy(asc(t.decisionSnapshots.createdAt));
    const [first, second] = rows;
    const decision = await db
      .select()
      .from(t.decisions)
      .where(eq(t.decisions.id, second!.decisionId));
    const forkId = randomUUID();
    await db
      .insert(t.decisions)
      .values({ ...decision[0]!, id: forkId, idempotencyKey: randomUUID() });
    await expect(
      db.insert(t.decisionSnapshots).values({
        decisionId: forkId,
        canonicalJson: second!.canonicalJson,
        sha256: second!.sha256,
        prevSha256: first!.sha256,
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      }),
    ).rejects.toThrow();
  });
});

describe("v4 snapshots stay verifiable", () => {
  it("checks a schema-4 row against the hash of its canonical JSON alone", () => {
    const text = '{"schemaVersion":4}';
    expect(snapshotDigest(null, text, 4)).toBe(sha256(text));
    expect(snapshotDigest("a".repeat(64), text, 4)).toBe(sha256(text));
    expect(snapshotDigest("a".repeat(64), text, 5)).not.toBe(sha256(text));
    expect(snapshotDigest(null, text, 5)).not.toBe(
      snapshotDigest("a".repeat(64), text, 5),
    );
  });
});
