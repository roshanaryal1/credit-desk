/**
 * Root-run verification only, against the explicitly provisioned isolated DB.
 * node --conditions=react-server --import tsx scripts/verify-review-concurrency.ts <private-config.json>
 * No provider calls, original DB access, immutable-history rewrites or secret output.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import { Pool, neonConfig } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import ws from "ws";

import { CONFIG_VERSION } from "../lib/checks/config";
import type { Db } from "../lib/db/client";
import * as t from "../lib/db/schema";
import { getInvoiceReview } from "../lib/queries/invoice";
import { canonicalJson, sha256 } from "../lib/trust/canonical";
import { saveDecision, type DecisionInput } from "../lib/trust/decide";
import { reviewState } from "../lib/trust/review";
import { verifySnapshot } from "../lib/trust/snapshot";

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_done, reject) => {
        timer = setTimeout(() => reject(Error(label)), 45000);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

async function run() {
  const configFile = process.argv[2];
  assert(configFile, "A private isolated-DB config file is required");
  assert.equal(
    (await stat(configFile)).mode & 0o077,
    0,
    "Verification config must be private",
  );
  const config = JSON.parse(await readFile(configFile, "utf8")) as {
    branchId: string;
    database: string;
    databaseUrl: string;
  };
  assert.equal(
    config.branchId,
    "br-little-block-a7rms69y",
    "Wrong verification branch",
  );
  assert.equal(
    config.database,
    "creditdesk_audit_182",
    "Wrong verification database",
  );
  const target = new URL(config.databaseUrl);
  assert.equal(
    decodeURIComponent(target.pathname.slice(1)),
    "creditdesk_audit_182",
    "Connection points at a different DB",
  );
  assert(
    target.hostname.endsWith(".neon.tech"),
    "Expected the provisioned Neon verification endpoint",
  );
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 8,
    options: "-c statement_timeout=60000",
  });
  const db = drizzle({ client: pool, schema: t }) as unknown as Db;
  const resources: (() => void)[] = [];
  let phase = "database-guard";
  const results: string[] = [];
  const analyst = {
    sessionId: "isolated-review-verifier",
    displayName: "Fictional verification analyst",
    mode: "SHADOW" as const,
  };
  try {
    assert.equal(
      (await pool.query<{ name: string }>("select current_database() as name"))
        .rows[0].name,
      "creditdesk_audit_182",
    );
    phase = "official-migrations";
    await migrate(db as unknown as Parameters<typeof migrate>[0], {
      migrationsFolder: "lib/db/migrations",
    });
    results.push("official-migrations");

    async function fixture() {
      const tag = randomUUID().replaceAll("-", "").slice(0, 16);
      const clientId = `verify_client_${tag}`;
      const debtorId = `verify_debtor_${tag}`;
      const batchId = `verify_batch_${tag}`;
      const invoiceId = `inv_verify_${tag}`;
      const ledgerId = `verify_ledger_${tag}`;
      await db.insert(t.clients).values({
        id: clientId,
        name: "Fictional concurrency borrower",
        industry: "services",
        facilityLimitCents: 1000000,
        advanceRateBps: 8000,
        paymentTermsDays: 30,
      });
      await db.insert(t.debtors).values({
        id: debtorId,
        clientId,
        name: "Fictional concurrency debtor",
        nzbn: `SYNTHETIC-VERIFY-${tag}`,
        firstSeenDate: "2026-01-01",
        creditBand: "A",
      });
      await db.insert(t.batches).values({
        id: batchId,
        clientId,
        submittedDate: "2026-10-20",
        status: "PENDING",
      });
      await db.insert(t.invoices).values({
        id: invoiceId,
        batchId,
        clientId,
        debtorId,
        invoiceNumber: "VERIFY-1",
        issueDate: "2026-10-01",
        dueDate: "2026-10-31",
        amountCents: 100000,
        description: "Fictional concurrency fixture",
      });
      await db.insert(t.ledgerEntries).values({
        id: ledgerId,
        clientId,
        debtorId,
        invoiceNumber: "VERIFY-1",
        issueDate: "2026-10-01",
        recordedDate: "2026-10-01",
        amountCents: 90000,
      });
      await db.insert(t.findings).values({
        id: `verify_finding_${tag}`,
        invoiceId,
        checkId: "LEDGER_MISMATCH",
        severity: "HIGH",
        details: { evidenceIds: [invoiceId, ledgerId], ledgerCents: 90000 },
        configVersion: CONFIG_VERSION,
      });
      return { tag, clientId, debtorId, batchId, invoiceId, ledgerId };
    }

    async function input(
      invoiceId: string,
      key: string = randomUUID(),
    ): Promise<DecisionInput> {
      return {
        invoiceId,
        decision: "HOLD",
        reason: "Fictional concurrent source verification",
        reviewVersion: (await reviewState(db, invoiceId)).version,
        idempotencyKey: key,
      };
    }

    /** The transport barrier delays real SQL, without mocking its response or transaction. */
    async function barrier(match: (text: string) => boolean, after: boolean) {
      const client = await pool.connect();
      const pid = (
        await client.query<{ pid: number }>("select pg_backend_pid() as pid")
      ).rows[0].pid;
      const entered = signal();
      const release = signal();
      resources.push(() => {
        release.resolve();
        client.release();
      });
      let armed = true;
      let attempts = 0;
      const observed = new Proxy(client, {
        get(target, key) {
          if (key !== "query") {
            const value: unknown = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          }
          return async (...args: unknown[]) => {
            const first = args[0];
            const text =
              typeof first === "string"
                ? first
                : ((first as { text?: string })?.text ?? "");
            if (/^begin\b/i.test(text)) attempts++;
            const stop = armed && match(text);
            if (stop) armed = false;
            if (stop && !after) {
              entered.resolve();
              await release.promise;
            }
            const result: unknown = await Reflect.apply(
              target.query,
              target,
              args,
            );
            if (stop && after) {
              entered.resolve();
              await release.promise;
            }
            return result;
          };
        },
      });
      return {
        db: drizzle({ client: observed, schema: t }) as unknown as Db,
        pid,
        entered: entered.promise,
        release: release.resolve,
        attempts: () => attempts,
      };
    }

    async function frozen(decisionId: string) {
      const [snapshot] = await db
        .select()
        .from(t.decisionSnapshots)
        .where(eq(t.decisionSnapshots.decisionId, decisionId));
      const body = JSON.parse(snapshot.canonicalJson) as {
        reviewedState: { panel: { invoice: { amountCents: number } } };
        reviewedStateSha256: string;
        checkContext: {
          invoice: { amountCents: number };
          ledgerEntry: { creditNotes: { id: string }[] };
        };
        explanation: unknown;
      };
      assert.equal(
        sha256(canonicalJson(body.reviewedState)),
        body.reviewedStateSha256,
        "Reviewed-state digest mismatch",
      );
      assert.deepEqual(await verifySnapshot(db, decisionId), {
        checksumMatches: true,
        chainMatches: true,
      });
      return body;
    }

    phase = "panel-read-race";
    const panelFixture = await fixture();
    const originalPanelVersion = (await reviewState(db, panelFixture.invoiceId))
      .version;
    const panelBarrier = await barrier(
      (text) =>
        text.includes('from "invoices"') &&
        text.includes('inner join "debtors"'),
      true,
    );
    const pendingPanel = getInvoiceReview(
      panelFixture.invoiceId,
      analyst,
      panelFixture.batchId,
      true,
      panelBarrier.db,
    );
    await bounded(panelBarrier.entered, "Panel barrier was not reached");
    await db
      .update(t.invoices)
      .set({ amountCents: 99999900 })
      .where(eq(t.invoices.id, panelFixture.invoiceId));
    await db
      .update(t.ledgerEntries)
      .set({ amountCents: 88888800 })
      .where(eq(t.ledgerEntries.id, panelFixture.ledgerId));
    panelBarrier.release();
    const panel = await bounded(pendingPanel, "Panel did not finish");
    assert.equal(
      panel?.invoice.amountCents,
      100000,
      "Panel invoice mixed revisions",
    );
    assert.equal(
      panel?.reviewVersion,
      originalPanelVersion,
      "Panel context/evidence mixed revisions",
    );
    assert(
      panel?.evidence.get(panelFixture.ledgerId)?.facts.includes("$900.00"),
      "Panel evidence mixed revisions",
    );
    const staleInput = {
      ...(await input(panelFixture.invoiceId)),
      reviewVersion: panel!.reviewVersion,
    };
    assert.deepEqual(
      (
        await saveDecision(db, staleInput, analyst, {
          codeSha: "isolated-concurrency",
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await db
          .select()
          .from(t.decisions)
          .where(eq(t.decisions.invoiceId, panelFixture.invoiceId))
      ).length,
      0,
    );
    results.push("panel-single-snapshot-and-stale-rejection");

    phase = "source-phantom-and-explanation-race";
    const race = await fixture();
    const submitted = await input(race.invoiceId);
    const saveBarrier = await barrier(
      (text) => text.startsWith('insert into "decisions"'),
      false,
    );
    const pendingSave = saveDecision(saveBarrier.db, submitted, analyst, {
      codeSha: "isolated-concurrency",
    });
    await bounded(saveBarrier.entered, "Save barrier was not reached");
    await db.transaction(async (writer) => {
      await writer
        .update(t.invoices)
        .set({ amountCents: 77777700 })
        .where(eq(t.invoices.id, race.invoiceId));
      await writer.insert(t.creditNotes).values({
        id: `verify_credit_${race.tag}`,
        ledgerEntryId: race.ledgerId,
        date: "2026-10-19",
        amountCents: 5000,
      });
      const runId = `verify_run_${race.tag}`;
      await writer.insert(t.agentRuns).values({
        id: runId,
        subjectType: "INVOICE",
        subjectId: race.invoiceId,
        provider: "scripted-fixture",
        model: "no-provider-call",
        promptVersion: "test",
        configVersion: CONFIG_VERSION,
        codeSha: "test",
        attempts: 1,
        status: "PASSED",
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: 0,
        asOfDate: "2026-10-20",
      });
      await writer.insert(t.explanations).values({
        id: `verify_exp_${race.tag}`,
        agentRunId: runId,
        summary: "Review the cited source.",
        riskLevel: "HIGH",
        recommendation: "HOLD",
        questionsForClient: [],
        claims: [
          { text: "Review this invoice.", evidenceIds: [race.invoiceId] },
        ],
        citedEvidenceIds: [race.invoiceId],
        validationStatus: "PASSED",
        validationErrors: [],
      });
    });
    saveBarrier.release();
    const saved = await bounded(pendingSave, "Save did not finish");
    if (saved.ok) {
      const body = await frozen(saved.decisionId);
      assert.equal(body.reviewedStateSha256, submitted.reviewVersion);
      assert.equal(
        body.checkContext.invoice.amountCents,
        100000,
        "Snapshot re-fetched a changed invoice",
      );
      assert.equal(body.reviewedState.panel.invoice.amountCents, 100000);
      assert.equal(
        body.checkContext.ledgerEntry.creditNotes.length,
        0,
        "Snapshot included a source phantom",
      );
      assert.equal(
        body.explanation,
        null,
        "Snapshot included a later explanation",
      );
    } else assert.equal(saved.reason, "STALE");
    assert.notEqual(
      (await reviewState(db, race.invoiceId)).version,
      submitted.reviewVersion,
    );
    results.push("source-update-credit-phantom-new-explanation-consistent");

    async function waitForChainLock(pid: number) {
      await bounded(
        (async () => {
          for (;;) {
            const waiting = await pool.query<{ n: string }>(
              "select count(*)::text as n from pg_locks where pid=$1 and locktype='advisory' and objid=4242001 and not granted",
              [pid],
            );
            if (waiting.rows[0].n !== "0") return;
            await new Promise<void>((done) => setTimeout(done, 25));
          }
        })(),
        "Competing transaction did not wait for chain lock",
      );
    }

    phase = "chain-lock-old-snapshot-race";
    const firstFixture = await fixture();
    const secondFixture = await fixture();
    const firstInput = await input(firstFixture.invoiceId);
    const secondInput = await input(secondFixture.invoiceId);
    const firstBarrier = await barrier(
      (text) => text.startsWith('insert into "decisions"'),
      false,
    );
    const secondBarrier = await barrier(() => false, false);
    const pendingFirst = saveDecision(firstBarrier.db, firstInput, analyst, {
      codeSha: "isolated-concurrency",
    });
    await bounded(firstBarrier.entered, "First chain barrier was not reached");
    const pendingSecond = saveDecision(secondBarrier.db, secondInput, analyst, {
      codeSha: "isolated-concurrency",
    });
    await waitForChainLock(secondBarrier.pid);
    firstBarrier.release();
    const [a, b] = await bounded(
      Promise.all([pendingFirst, pendingSecond]),
      "Chain race did not finish",
    );
    assert(
      a.ok && b.ok,
      "Unchanged independent decisions should succeed after retry",
    );
    await frozen(a.decisionId);
    await frozen(b.decisionId);
    assert(
      secondBarrier.attempts() >= 2,
      "Expected stale lock-wait snapshot to retry",
    );
    results.push("global-chain-lock-wait-serialization-retry");

    phase = "duplicate-key-lock-race";
    const duplicateFixture = await fixture();
    const duplicateInput = await input(duplicateFixture.invoiceId);
    const duplicateFirst = await barrier(
      (text) => text.startsWith('insert into "decisions"'),
      false,
    );
    const duplicateSecond = await barrier(() => false, false);
    const d1 = saveDecision(duplicateFirst.db, duplicateInput, analyst, {
      codeSha: "isolated-concurrency",
    });
    await bounded(duplicateFirst.entered, "Duplicate barrier was not reached");
    const d2 = saveDecision(duplicateSecond.db, duplicateInput, analyst, {
      codeSha: "isolated-concurrency",
    });
    await waitForChainLock(duplicateSecond.pid);
    duplicateFirst.release();
    const [r1, r2] = await bounded(
      Promise.all([d1, d2]),
      "Duplicate race did not finish",
    );
    assert(
      r1.ok && r2.ok && r2.duplicate,
      "Exact competing retry must return its winner",
    );
    assert.equal(r1.decisionId, r2.decisionId);
    assert.equal(
      (
        await db
          .select()
          .from(t.decisions)
          .where(eq(t.decisions.idempotencyKey, duplicateInput.idempotencyKey))
      ).length,
      1,
    );
    assert.equal(
      (
        await db
          .select()
          .from(t.decisionSnapshots)
          .where(eq(t.decisionSnapshots.decisionId, r1.decisionId))
      ).length,
      1,
    );
    await frozen(r1.decisionId);
    results.push("exact-concurrent-key-retry-preserves-one-history");

    phase = "full-uuid-prefix-collision";
    const prefixFixture = await fixture();
    const prefix = randomUUID().slice(0, 8);
    const k1 = `${prefix}-0000-4000-8000-000000000001`;
    const k2 = `${prefix}-1111-4111-8111-000000000002`;
    const p1 = await saveDecision(
      db,
      await input(prefixFixture.invoiceId, k1),
      analyst,
      { codeSha: "isolated-concurrency" },
    );
    const p2 = await saveDecision(
      db,
      await input(prefixFixture.invoiceId, k2),
      analyst,
      { codeSha: "isolated-concurrency" },
    );
    assert(p1.ok && p2.ok);
    assert.notEqual(p1.decisionId, p2.decisionId);
    assert(p1.decisionId.includes(k1) && p2.decisionId.includes(k2));
    await frozen(p2.decisionId);
    results.push("full-uuid-collision-regression");
    console.log(JSON.stringify({ status: "PASSED", checks: results }));
  } catch (error) {
    // Do not print driver messages, query values, config or connection strings.
    console.error(
      JSON.stringify({
        status: "FAILED",
        phase,
        errorCode:
          typeof error === "object" &&
          error &&
          "code" in error &&
          /^[A-Z0-9_]{3,20}$/.test(String(error.code))
            ? String(error.code)
            : "UNCLASSIFIED",
        assertion:
          error instanceof assert.AssertionError
            ? error.message.split("\n")[0]
            : "Verification operation failed",
      }),
    );
    process.exitCode = 1;
  } finally {
    for (const close of resources.reverse()) close();
    await pool.end();
  }
}

run().catch(() => {
  console.error(
    JSON.stringify({
      status: "FAILED",
      phase: "private-configuration",
      assertion: "Verification configuration was rejected",
    }),
  );
  process.exitCode = 1;
});
