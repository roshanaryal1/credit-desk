import { describe, expect, it } from "vitest";

import {
  projectSyncOperations,
  readSyntheticSyncOperations,
} from "@/lib/data/sync-operations";
import {
  claimSyncJob,
  ensureSyncJob,
  failSyncJob,
} from "@/lib/data/sync-retry";
import { createMemoryDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

const at = (iso: string) => new Date(iso);
const now = at("2026-10-20T12:00:00Z");

async function seeded() {
  const db = await createMemoryDb();
  await db.insert(t.clients).values([
    {
      id: "client-a",
      name: "Synthetic Customer A",
      industry: "services",
      facilityLimitCents: 500_000,
      paymentTermsDays: 30,
    },
    {
      id: "client-b",
      name: "Synthetic Customer B",
      industry: "services",
      facilityLimitCents: 500_000,
      paymentTermsDays: 30,
    },
  ]);
  return db;
}

describe("read-only ingestion operations (#100)", () => {
  it("distinguishes expired leases, due retries, dead letters and pending jobs", async () => {
    const db = await seeded();
    const connection = (suffix: string) => ({
      sourceKind: "ACCOUNTING" as const,
      clientId: "client-a",
      connectionId: suffix,
    });

    const expired = await ensureSyncJob(
      db, connection("expired"), at("2026-10-20T11:00:00Z"),
    );
    await claimSyncJob(db, expired, at("2026-10-20T11:00:00Z"), 30);

    const due = await ensureSyncJob(
      db, connection("due"), at("2026-10-20T11:50:00Z"),
    );
    const dueClaim = await claimSyncJob(
      db, due, at("2026-10-20T11:50:00Z"),
    );
    expect(await failSyncJob(
      db, dueClaim!, "TIMEOUT", at("2026-10-20T11:50:00Z"),
    )).toBe("RETRY");

    const waiting = await ensureSyncJob(
      db, connection("waiting"), at("2026-10-20T11:59:30Z"),
    );
    const waitingClaim = await claimSyncJob(
      db, waiting, at("2026-10-20T11:59:30Z"),
    );
    await failSyncJob(
      db, waitingClaim!, "NETWORK", at("2026-10-20T11:59:30Z"),
    );

    const dead = await ensureSyncJob(
      db, connection("dead"), at("2026-10-20T11:55:00Z"),
    );
    const deadClaim = await claimSyncJob(
      db, dead, at("2026-10-20T11:55:00Z"),
    );
    await failSyncJob(
      db, deadClaim!, "CONFLICT", at("2026-10-20T11:55:00Z"),
    );
    await ensureSyncJob(
      db, connection("new"), at("2026-10-20T12:30:00Z"),
    );

    const view = await readSyntheticSyncOperations(db, now);
    expect(view.counts).toMatchObject({
      connections: 5,
      deadLetters: 1,
      expiredLeases: 1,
      dueRetries: 1,
      unknownSources: 5,
    });
    const states = new Map(view.rows.map((r) => [
      r.connectionId,
      r.condition,
    ]));
    expect(states).toEqual(new Map([
      ["dead", "DEAD_LETTER"],
      ["due", "RETRY_DUE"],
      ["expired", "LEASE_EXPIRED"],
      ["new", "QUEUED"],
      ["waiting", "RETRY_WAIT"],
    ]));
    expect(view.rows.find((r) => r.connectionId === "dead"))
      .toMatchObject({ lastSafeError: "CONFLICT", exception: "DEAD_LETTER" });
    expect(view.rows.every((r) => r.clientName === "Synthetic Customer A"))
      .toBe(true);
    expect(view.rows.every((r) => !("leaseToken" in r))).toBe(true);
    expect(await db.select().from(t.ingestionEvents)).toHaveLength(0);
  }, 90_000);

  it("shows fresh/stale/errored connections and never uses future checkpoint data", async () => {
    const db = await seeded();
    await db.insert(t.ingestionCheckpoints).values([
      {
        sourceKind: "BANK",
        connectionId: "fresh",
        clientId: "client-a",
        lastSuccessAt: at("2026-10-20T11:30:00Z"),
        updatedAt: at("2026-10-20T11:30:00Z"),
      },
      {
        sourceKind: "ACCOUNTING",
        connectionId: "stale",
        clientId: "client-b",
        lastSuccessAt: at("2026-10-18T10:00:00Z"),
        updatedAt: at("2026-10-18T10:00:00Z"),
      },
      {
        sourceKind: "BANK",
        connectionId: "failed",
        clientId: "client-b",
        lastSuccessAt: at("2026-10-19T11:00:00Z"),
        lastFailureAt: at("2026-10-20T11:55:00Z"),
        updatedAt: at("2026-10-20T11:55:00Z"),
      },
      {
        sourceKind: "BANK",
        connectionId: "future",
        clientId: "client-b",
        lastSuccessAt: at("2026-10-21T11:00:00Z"),
        updatedAt: at("2026-10-21T11:00:00Z"),
      },
    ]);
    const first = await readSyntheticSyncOperations(db, now);
    const byConnection = new Map(first.rows.map((r) => [
      r.connectionId,
      r,
    ]));
    expect(byConnection.get("fresh")).toMatchObject({
      freshness: "FRESH",
      condition: "NOT_SCHEDULED",
    });
    expect(byConnection.get("stale")?.freshness).toBe("STALE");
    expect(byConnection.get("failed")).toMatchObject({
      freshness: "ERROR",
      exception: "SOURCE_ERROR",
    });
    expect(byConnection.get("future")).toMatchObject({
      freshness: "UNKNOWN",
      exception: "FUTURE_CHECKPOINT",
      lastSuccessAt: null,
    });
    expect(first.counts).toMatchObject({
      sourceErrors: 1,
      unknownSources: 1,
      connections: 4,
    });
  }, 90_000);

  it("fails closed on impossible jobs, invalid scope, unsafe timestamps and missing clients", async () => {
    const db = await seeded();
    expect(() => projectSyncOperations([], [], at("invalid")))
      .toThrow(/Invalid UTC/);
    expect(() => projectSyncOperations([], [], now, 0))
      .toThrow(/Invalid freshness/);
    await ensureSyncJob(
      db,
      {
        sourceKind: "ACCOUNTING",
        connectionId: "valid",
        clientId: "client-a",
      },
      now,
    );
    const jobs = await db.select().from(t.ingestionSyncJobs);
    expect(() => projectSyncOperations([...jobs, ...jobs], [], now))
      .toThrow(/Duplicate/);
    expect(() => projectSyncOperations([
      { ...jobs[0]!, state: "CORRUPT" },
    ], [], now)).toThrow(/Unknown synthetic sync job state/);
    expect(await readSyntheticSyncOperations(db, now))
      .toMatchObject({ sourceMode: "SYNTHETIC_ONLY" });
  }, 90_000);
});
