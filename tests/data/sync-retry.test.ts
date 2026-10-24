import { describe, expect, it } from "vitest";

import { createMemoryDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import {
  claimSyncJob,
  completeSyncJob,
  dueSyncJobIds,
  ensureSyncJob,
  expireExhaustedLeases,
  failSyncJob,
  getSyncJob,
  retryDelayMs,
} from "@/lib/data/sync-retry";

const connection = {
  sourceKind: "ACCOUNTING" as const,
  connectionId: "synthetic-xero",
  clientId: "client-1",
};
const at = (iso: string) => new Date(iso);
const now = at("2026-10-24T08:00:00Z");
const plus = (minutes: number) =>
  at(new Date(now.getTime() + minutes * 60_000).toISOString());

async function dbWithClients() {
  const db = await createMemoryDb();
  await db.insert(t.clients).values([
    {
      id: "client-1",
      name: "Synthetic Trading",
      industry: "services",
      facilityLimitCents: 500_000,
      paymentTermsDays: 30,
      advanceRateBps: 7500,
    },
    {
      id: "client-2",
      name: "Synthetic Logistics",
      industry: "logistics",
      facilityLimitCents: 700_000,
      paymentTermsDays: 30,
      advanceRateBps: 8000,
    },
  ]);
  return db;
}

describe("durable retry, lease fencing and dead letter", () => {
  it("enqueues idempotently without replacing active attempts", async () => {
    const db = await dbWithClients();
    const id = await ensureSyncJob(db, connection, now, 3);
    expect(await ensureSyncJob(db, connection, plus(-10), 8)).toBe(id);
    expect(await dueSyncJobIds(db, now)).toEqual([id]);
    const row = await getSyncJob(db, id);
    expect(row).toMatchObject({
      state: "PENDING",
      attempts: 0,
      maxAttempts: 3,
    });
    expect(row?.nextAttemptAt.toISOString()).toBe(now.toISOString());
    expect("payload" in (row ?? {})).toBe(false);
  });

  it("only allows one worker to acquire a live lease, and fences expiry", async () => {
    const db = await dbWithClients();
    const id = await ensureSyncJob(db, connection, now, 3);
    const first = await claimSyncJob(db, id, now, 30);
    expect(first?.attempts).toBe(1);
    expect(await claimSyncJob(db, id, now, 30)).toBeNull();
    expect(await dueSyncJobIds(db, plus(0.4))).toEqual([]);
    const second = await claimSyncJob(db, id, plus(1), 30);
    expect(second?.attempts).toBe(2);
    expect(second?.leaseToken).not.toEqual(first?.leaseToken);
    expect(await completeSyncJob(db, first!, plus(1))).toBe(false);
    expect(await failSyncJob(db, first!, "TIMEOUT", plus(1))).toBe(
      "STALE_LEASE",
    );
    expect(await completeSyncJob(db, second!, plus(1.1))).toBe(true);
    expect((await getSyncJob(db, id))?.state).toBe("SUCCEEDED");
    expect(await dueSyncJobIds(db, plus(3))).toEqual([]);
  });

  it("retries transient errors on a stable exponential schedule", async () => {
    const db = await dbWithClients();
    const id = await ensureSyncJob(db, connection, now, 4);
    const first = (await claimSyncJob(db, id, now))!;
    expect(await failSyncJob(db, first, "RATE_LIMIT", now)).toBe("RETRY");
    expect((await getSyncJob(db, id))?.lastErrorCode).toBe("RATE_LIMIT");
    expect((await getSyncJob(db, id))?.nextAttemptAt).toEqual(plus(1));
    expect(await dueSyncJobIds(db, plus(0.5))).toEqual([]);
    expect(await dueSyncJobIds(db, plus(1))).toEqual([id]);
    const second = (await claimSyncJob(db, id, plus(1)))!;
    expect(second.attempts).toBe(2);
    expect(await failSyncJob(db, second, "TIMEOUT", plus(1))).toBe("RETRY");
    expect((await getSyncJob(db, id))?.nextAttemptAt).toEqual(plus(3));
    expect(retryDelayMs(5)).toBe(960_000);
    expect(retryDelayMs(10)).toBe(3_600_000);
  });

  it("puts nonretryable source conflicts directly in the dead letter state", async () => {
    const db = await dbWithClients();
    const id = await ensureSyncJob(db, connection, now, 5);
    const claim = (await claimSyncJob(db, id, now))!;
    expect(await failSyncJob(db, claim, "CONFLICT", now)).toBe("DEAD");
    expect(await dueSyncJobIds(db, plus(100))).toEqual([]);
    expect((await getSyncJob(db, id))?.leaseToken).toBeNull();
    expect((await getSyncJob(db, id))?.lastErrorCode).toBe("CONFLICT");
  });

  it("retires a crashed final lease after the last allowable attempt", async () => {
    const db = await dbWithClients();
    const id = await ensureSyncJob(db, connection, now, 1);
    const claim = (await claimSyncJob(db, id, now, 30))!;
    expect(await expireExhaustedLeases(db, plus(0.3))).toBe(0);
    expect(await dueSyncJobIds(db, plus(1))).toEqual([]);
    const row = await getSyncJob(db, id);
    expect(row).toMatchObject({
      state: "DEAD",
      attempts: 1,
      lastErrorCode: "INTERNAL",
    });
    expect(await completeSyncJob(db, claim, plus(1))).toBe(false);
  });

  it("rejects invalid worker requests and keeps client scopes distinct", async () => {
    const db = await dbWithClients();
    const first = await ensureSyncJob(db, connection, now, 2);
    const second = await ensureSyncJob(
      db,
      { ...connection, clientId: "client-2" },
      now,
      2,
    );
    expect(second).not.toBe(first);
    expect((await dueSyncJobIds(db, now)).sort()).toEqual(
      [first, second].sort(),
    );
    await expect(
      ensureSyncJob(db, connection, new Date("invalid")),
    ).rejects.toThrow(/valid UTC/);
    await expect(ensureSyncJob(db, connection, now, 21)).rejects.toThrow(
      /maxAttempts/,
    );
    await expect(claimSyncJob(db, first, now, 2)).rejects.toThrow(
      /lease request/,
    );
    expect(() => retryDelayMs(0)).toThrow(/attempt/);
    const claim = (await claimSyncJob(db, first, now))!;
    await expect(
      failSyncJob(db, claim, "secret+token" as "TIMEOUT", now),
    ).rejects.toThrow(/safe error/);
  });
});
