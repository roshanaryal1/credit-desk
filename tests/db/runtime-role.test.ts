import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { incidentAction } from "@/app/actions";
import type { LlmClient } from "@/lib/agent/llm";
import { runAgentForInvoice } from "@/lib/agent/runner";
import { runAllBatches } from "@/lib/checks/runner";
import { addDays } from "@/lib/dates";
import * as database from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import {
  getSourceCheckpoint,
  recordSourceBatch,
  recordSourceFailure,
} from "@/lib/data/ingest-store";
import {
  claimSyncJob,
  completeSyncJob,
  ensureSyncJob,
  expireExhaustedLeases,
  failSyncJob,
  getSyncJob,
  persistClaimedSourceBatch,
} from "@/lib/data/sync-retry";
import { DEMO_TODAY } from "@/lib/demo";
import {
  provisionUser,
  setUserActive,
  updateAccess,
} from "@/lib/identity/admin";
import { bindUser, createSession, revokeSessions } from "@/lib/identity/store";
import { getInvoiceReview } from "@/lib/queries/invoice";
import { hitsSince, recordHit, takeAll } from "@/lib/rate-limit";
import { DEV_PARAMS, generate } from "@/lib/seed/generate";
import { writeDataset } from "@/lib/seed/write";
import { saveDecision } from "@/lib/trust/decide";
import { reviewState } from "@/lib/trust/review";
import { runWatchForDate } from "@/lib/watch/runner";
import {
  applyCreditCaseAction,
  createCreditCase,
} from "@/lib/workflow/case-store";

// Replace request context and cache invalidation. All SQL and domain functions
// execute against the same PGlite connection after SET ROLE.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/demo-session", () => ({
  canPerformDemoWrite: async () => true,
}));
vi.mock("@/lib/session", () => ({
  MODE_COOKIE: "cd_mode",
  writingAnalyst: async () => ({
    sessionId: "runtime-analyst",
    displayName: "Runtime analyst",
    mode: "SHADOW",
  }),
}));
vi.mock("@/lib/identity/current", () => ({
  analystMayWriteForClient: async () => true,
}));

let db: database.Db;
const ds = generate(DEV_PARAMS);
const now = new Date("2026-10-27T08:00:00Z");
const later = new Date(now.getTime() + 60_000);
const analyst = {
  sessionId: "runtime-analyst",
  displayName: "Runtime analyst",
  mode: "ASSIST" as const,
};

beforeAll(async () => {
  db = await database.createMemoryDb();
  await writeDataset(db, ds);
  await db.execute(sql`CREATE ROLE credit_desk_app LOGIN`);
  const grants = await readFile("scripts/db/runtime-grants.sql", "utf8");
  await db.$client.exec(grants);
  await db.execute(sql`SET ROLE credit_desk_app`);
  expect((await db.execute(sql`SELECT current_user`)).rows).toEqual([
    { current_user: "credit_desk_app" },
  ]);
  vi.spyOn(database, "getDb").mockResolvedValue(db);
}, 30_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await db?.$client.close();
});

describe("versioned runtime grants", () => {
  it("stores findings, agent evidence, exposure and a decision", async () => {
    const results = await runAllBatches(db);
    const invoiceId = results.find((r) => r.findings.length > 0)!.invoiceId;
    const [invoice] = await db
      .select()
      .from(t.invoices)
      .where(eq(t.invoices.id, invoiceId));
    let calls = 0;
    const llm: LlmClient = {
      provider: "test",
      model: "runtime-role",
      async complete() {
        calls++;
        return {
          tokensIn: 10,
          tokensOut: 10,
          message: {
            role: "assistant",
            refusal: null,
            content:
              calls === 1
                ? null
                : JSON.stringify({
                    summary: "Invoice requires review.",
                    risk_level: "medium",
                    recommendation: "HOLD",
                    questions_for_client: [],
                    claims: [
                      {
                        text: "Invoice requires review.",
                        evidence_ids: [invoiceId],
                      },
                    ],
                    cited_evidence_ids: [invoiceId],
                  }),
            ...(calls === 1
              ? {
                  tool_calls: [
                    {
                      id: "invoice-call",
                      type: "function" as const,
                      function: {
                        name: "get_invoice",
                        arguments: JSON.stringify({ invoice_id: invoiceId }),
                      },
                    },
                  ],
                }
              : {}),
          },
        };
      },
    };
    const outcome = await runAgentForInvoice(db, llm, invoiceId, {
      codeSha: "test",
      log: () => {},
    });
    expect(outcome.status).toBe("PASSED");
    expect(await db.select().from(t.agentEvidenceManifests)).toHaveLength(1);
    expect(await db.select().from(t.explanations)).toHaveLength(1);
    const panel = await getInvoiceReview(
      invoiceId,
      analyst,
      invoice!.batchId,
      false,
      db,
    );
    expect(panel?.explanation).toBeTruthy();
    expect(await db.select().from(t.exposures)).toHaveLength(1);
    const state = await reviewState(db, invoiceId);
    expect(
      await saveDecision(
        db,
        {
          invoiceId,
          decision: "HOLD",
          reason: "Waiting for review",
          reviewVersion: state.version,
          idempotencyKey: randomUUID(),
        },
        analyst,
        { codeSha: "test" },
      ),
    ).toMatchObject({ ok: true });
    expect(await db.select().from(t.decisions)).toHaveLength(1);
    expect(await db.select().from(t.decisionSnapshots)).toHaveLength(1);
  }, 30_000);

  it("records watch incidents, updates detection dates and saves an incident action", async () => {
    expect((await runWatchForDate(db, DEMO_TODAY)).length).toBeGreaterThan(0);
    // Running the next day exercises UPDATE on existing incidents.
    const nextDay = addDays(DEMO_TODAY, 1);
    expect((await runWatchForDate(db, nextDay)).length).toBeGreaterThan(0);
    const incidents = await db.select().from(t.incidents);
    expect(
      incidents.some(
        (row) =>
          row.firstDetectedDate === DEMO_TODAY &&
          row.lastDetectedDate === nextDay,
      ),
    ).toBe(true);
    const [incident] = incidents;
    const form = new FormData();
    form.set("incidentId", incident!.id);
    form.set("action", "ACKNOWLEDGED");
    form.set("note", "Runtime role review");
    expect(await incidentAction({ status: "idle" }, form)).toMatchObject({
      status: "saved",
    });
    expect(
      (await db.select().from(t.incidentEvents)).some(
        (row) => row.status === "ACKNOWLEDGED",
      ),
    ).toBe(true);
    expect(
      (await db.select().from(t.auditEvents)).some(
        (row) => row.action === "INCIDENT_ACKNOWLEDGED",
      ),
    ).toBe(true);
  });

  it("persists checkpoint upserts and the sync lease, failure and completion paths", async () => {
    const connection = {
      sourceKind: "ACCOUNTING" as const,
      connectionId: "runtime-source",
      clientId: ds.clients[0]!.id,
    };
    const event = {
      ...connection,
      eventId: "event-one",
      entityId: "source-invoice",
      effectiveDate: "2026-10-27",
      observedAt: now.toISOString(),
      payload: { amount: 100 },
    };
    const id = await ensureSyncJob(db, connection, now);
    const claim = await claimSyncJob(db, id, now);
    expect(claim).not.toBeNull();
    expect(
      await persistClaimedSourceBatch(db, claim!, [event], now, "one"),
    ).toEqual({ inserted: 1, duplicates: 0 });
    expect(
      await recordSourceBatch(db, connection, [event], later, "two"),
    ).toEqual({ inserted: 0, duplicates: 1 });
    await recordSourceFailure(db, connection, later);
    await recordSourceFailure(db, connection, new Date(later.getTime() + 1));
    expect(await getSourceCheckpoint(db, connection)).toMatchObject({
      cursor: "two",
      lastSuccessAt: later,
    });
    expect((await getSyncJob(db, id))?.state).toBe("SUCCEEDED");

    const retryId = await ensureSyncJob(
      db,
      {
        ...connection,
        connectionId: "retry",
      },
      now,
    );
    const retry = await claimSyncJob(db, retryId, now);
    expect(await failSyncJob(db, retry!, "TIMEOUT", now)).toBe("RETRY");
    const next = await claimSyncJob(db, retryId, later);
    expect(await completeSyncJob(db, next!, later)).toBe(true);

    const expiredId = await ensureSyncJob(
      db,
      {
        ...connection,
        connectionId: "expired",
      },
      now,
      1,
    );
    expect(await claimSyncJob(db, expiredId, now, 10)).not.toBeNull();
    expect(await expireExhaustedLeases(db, later)).toBe(1);
  });

  it("creates and transitions a case with append-only history", async () => {
    const invoice = ds.invoices[0]!;
    const manager = {
      subject: "manager",
      tenantId: "runtime",
      issuer: "https://id.test.example",
      roles: ["RISK_MANAGER" as const],
      clientGrants: [invoice.clientId],
      mfaSatisfied: true,
      authenticatedUntilMs: now.getTime() + 60_000,
    };
    expect(
      await createCreditCase(
        db,
        {
          id: "runtime-case",
          tenantId: manager.tenantId,
          clientId: invoice.clientId,
          subjectType: "INVOICE",
          subjectId: invoice.id,
          priority: "HIGH",
          dueDate: null,
        },
        manager,
        now.toISOString(),
      ),
    ).toMatchObject({ state: "NEW" });
    expect(
      await applyCreditCaseAction(
        db,
        "runtime-case",
        {
          kind: "ASSIGN",
          ownerId: "analyst",
        },
        manager,
        0,
        now.toISOString(),
      ),
    ).toMatchObject({ version: 1 });
    expect(await db.select().from(t.creditCaseEvents)).toHaveLength(2);
  });

  it("records rate limits, sign-in, access changes and session revocation", async () => {
    await recordHit(db, "runtime");
    expect(await hitsSince(db, "runtime", 60_000)).toBe(1);
    expect(
      await takeAll(db, [{ key: "runtime", max: 2, windowMs: 60_000 }]),
    ).toBe(true);
    const admin = { userId: "runtime-admin", tenantId: "runtime" };
    const provisioned = await provisionUser(db, admin, {
      email: "runtime@example.test",
      displayName: "Runtime user",
      roles: ["ANALYST"],
      clientIds: [ds.clients[0]!.id],
    });
    expect(provisioned.ok).toBe(true);
    if (!provisioned.ok) throw new Error(provisioned.message);
    const userId = provisioned.userId;
    expect(
      await bindUser(db, admin.tenantId, {
        issuer: "https://id.example.test",
        subject: "runtime-subject",
        email: "runtime@example.test",
        emailVerified: true,
        mfa: true,
      }),
    ).toEqual({ ok: true, userId });
    const session = await createSession(db, userId, true, now);
    expect(
      await updateAccess(db, admin, userId, {
        roles: ["CHECKER"],
        clientIds: [ds.clients[1]!.id],
      }),
    ).toMatchObject({ ok: true });
    expect(
      await revokeSessions(
        db,
        { sessionId: session.sessionId },
        "SIGN_OUT",
        userId,
        now,
      ),
    ).toBe(1);
    await createSession(db, userId, true, now);
    expect(await setUserActive(db, admin, userId, false, now)).toMatchObject({
      ok: true,
    });
    expect(
      (await db.select().from(t.authSessions)).every(
        (row) => row.revokedAt !== null,
      ),
    ).toBe(true);
  });

  it.each(t.APPEND_ONLY_TABLES)(
    "denies mutation and trigger disabling on %s",
    async (table) => {
      const column =
        table === "decision_snapshots"
          ? "decision_id"
          : table === "agent_evidence_manifests"
            ? "run_id"
            : "id";
      const target = sql`public.${sql.identifier(table)}`;
      const denied = { cause: { code: "42501" } };
      await expect(
        db.execute(
          sql`UPDATE ${target} SET ${sql.identifier(column)} = ${sql.identifier(column)}`,
        ),
      ).rejects.toMatchObject(denied);
      await expect(
        db.execute(sql`DELETE FROM ${target}`),
      ).rejects.toMatchObject(denied);
      await expect(
        db.execute(sql`TRUNCATE ${target} CASCADE`),
      ).rejects.toMatchObject(denied);
      await expect(
        db.execute(sql`ALTER TABLE ${target} DISABLE TRIGGER reject_truncate`),
      ).rejects.toMatchObject(denied);
    },
  );

  it("requires review if a migration introduces a public sequence", async () => {
    const sequences = await db.execute(sql`SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'S'`);
    expect(sequences.rows).toEqual([]);
  });
});
