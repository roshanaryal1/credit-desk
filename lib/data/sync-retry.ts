import "server-only";

import { createHash, randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  gt,
  gte,
  isNotNull,
  lte,
  lt,
  or,
  sql,
} from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

import type { SourceConnection } from "./ingest-store";

export type SyncErrorCode =
  | "TIMEOUT"
  | "NETWORK"
  | "RATE_LIMIT"
  | "PROVIDER_DOWN"
  | "INTERNAL"
  | "INVALID_DATA"
  | "REVOKED_CONSENT"
  | "CONFLICT";

const PERMANENT = new Set<SyncErrorCode>([
  "INVALID_DATA",
  "REVOKED_CONSENT",
  "CONFLICT",
]);

export interface ClaimedSyncJob {
  id: string;
  connection: SourceConnection;
  leaseToken: string;
  attempts: number;
  leaseUntil: Date;
}

/** Opaque, deterministic ID for one authorised connection's sync intent. */
function identity(connection: SourceConnection): string {
  if (
    !["BANK", "ACCOUNTING"].includes(connection.sourceKind) ||
    !connection.connectionId.trim() ||
    !connection.clientId.trim()
  ) {
    throw new Error("A valid scoped source connection is required");
  }
  return createHash("sha256")
    .update(
      JSON.stringify([
        connection.sourceKind,
        connection.connectionId,
        connection.clientId,
      ]),
    )
    .digest("hex");
}

function validInstant(date: Date): void {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error("A valid UTC instant is required");
  }
}

/** Exponential retry, capped at one hour, with no non-deterministic jitter. */
export function retryDelayMs(attempt: number): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 20) {
    throw new Error("Invalid retry attempt");
  }
  return Math.min(3_600_000, 60_000 * 2 ** (attempt - 1));
}

/**
 * Register work; repeated calls preserve the current attempt/lease state.
 * Only references are stored. No banking credentials or customer payload.
 */
export async function ensureSyncJob(
  db: Db,
  connection: SourceConnection,
  dueAt: Date,
  maxAttempts = 5,
): Promise<string> {
  validInstant(dueAt);
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 20
  ) {
    throw new Error("maxAttempts must be between 1 and 20");
  }
  const id = identity(connection);
  await db
    .insert(t.ingestionSyncJobs)
    .values({
      id,
      ...connection,
      state: "PENDING",
      maxAttempts,
      nextAttemptAt: dueAt,
      updatedAt: dueAt,
    })
    .onConflictDoNothing();
  return id;
}

/** Turn exhausted crashed leases into durable dead-letter records. */
export async function expireExhaustedLeases(
  db: Db,
  now: Date,
): Promise<number> {
  validInstant(now);
  const rows = await db
    .update(t.ingestionSyncJobs)
    .set({
      state: "DEAD",
      leaseToken: null,
      leaseUntil: null,
      lastErrorCode: "INTERNAL",
      lastErrorAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(t.ingestionSyncJobs.state, "LEASED"),
        lte(t.ingestionSyncJobs.leaseUntil, now),
        gte(t.ingestionSyncJobs.attempts, t.ingestionSyncJobs.maxAttempts),
      ),
    )
    .returning({ id: t.ingestionSyncJobs.id });
  return rows.length;
}

/**
 * Returns *candidates*; selection is not the concurrency guarantee.
 * Each worker MUST separately acquire a compare-and-swap lease.
 */
export async function dueSyncJobIds(
  db: Db,
  now: Date,
  limit = 20,
): Promise<string[]> {
  validInstant(now);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Invalid batch size");
  }
  await expireExhaustedLeases(db, now);
  const ready = await db
    .select({ id: t.ingestionSyncJobs.id })
    .from(t.ingestionSyncJobs)
    .where(
      and(
        lt(t.ingestionSyncJobs.attempts, t.ingestionSyncJobs.maxAttempts),
        or(
          and(
            eq(t.ingestionSyncJobs.state, "PENDING"),
            lte(t.ingestionSyncJobs.nextAttemptAt, now),
          ),
          and(
            eq(t.ingestionSyncJobs.state, "LEASED"),
            isNotNull(t.ingestionSyncJobs.leaseUntil),
            lte(t.ingestionSyncJobs.leaseUntil, now),
          ),
        ),
      ),
    )
    .orderBy(
      asc(t.ingestionSyncJobs.nextAttemptAt),
      asc(t.ingestionSyncJobs.id),
    )
    .limit(limit);
  return ready.map((row) => row.id);
}

/** Atomic lease prevents two workers from owning the same job simultaneously. */
export async function claimSyncJob(
  db: Db,
  id: string,
  now: Date,
  leaseSeconds = 300,
): Promise<ClaimedSyncJob | null> {
  validInstant(now);
  if (
    !id.trim() ||
    !Number.isSafeInteger(leaseSeconds) ||
    leaseSeconds < 10 ||
    leaseSeconds > 3600
  ) {
    throw new Error("Invalid sync lease request");
  }
  const leaseToken = randomUUID();
  const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
  const [row] = await db
    .update(t.ingestionSyncJobs)
    .set({
      state: "LEASED",
      attempts: sql`${t.ingestionSyncJobs.attempts} + 1`,
      leaseToken,
      leaseUntil,
      updatedAt: now,
    })
    .where(
      and(
        eq(t.ingestionSyncJobs.id, id),
        lt(t.ingestionSyncJobs.attempts, t.ingestionSyncJobs.maxAttempts),
        or(
          and(
            eq(t.ingestionSyncJobs.state, "PENDING"),
            lte(t.ingestionSyncJobs.nextAttemptAt, now),
          ),
          and(
            eq(t.ingestionSyncJobs.state, "LEASED"),
            lte(t.ingestionSyncJobs.leaseUntil, now),
          ),
        ),
      ),
    )
    .returning();
  if (!row) return null;
  return {
    id: row.id,
    connection: {
      sourceKind: row.sourceKind as SourceConnection["sourceKind"],
      connectionId: row.connectionId,
      clientId: row.clientId,
    },
    leaseToken,
    attempts: row.attempts,
    leaseUntil,
  };
}

/**
 * Completion is fenced by token, attempt and expiry. A slow worker cannot
 * acknowledge success after another worker has recovered an expired lease.
 */
export async function completeSyncJob(
  db: Db,
  claim: ClaimedSyncJob,
  now: Date,
): Promise<boolean> {
  validInstant(now);
  const rows = await db
    .update(t.ingestionSyncJobs)
    .set({
      state: "SUCCEEDED",
      leaseToken: null,
      leaseUntil: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(t.ingestionSyncJobs.id, claim.id),
        eq(t.ingestionSyncJobs.state, "LEASED"),
        eq(t.ingestionSyncJobs.leaseToken, claim.leaseToken),
        eq(t.ingestionSyncJobs.attempts, claim.attempts),
        gt(t.ingestionSyncJobs.leaseUntil, now),
      ),
    )
    .returning({ id: t.ingestionSyncJobs.id });
  return rows.length === 1;
}

/**
 * Persist only an allowlisted error code; raw provider errors, tokens, account
 * numbers and payloads must never enter the retry table.
 */
export async function failSyncJob(
  db: Db,
  claim: ClaimedSyncJob,
  code: SyncErrorCode,
  now: Date,
): Promise<"RETRY" | "DEAD" | "STALE_LEASE"> {
  validInstant(now);
  const known: SyncErrorCode[] = [
    "TIMEOUT",
    "NETWORK",
    "RATE_LIMIT",
    "PROVIDER_DOWN",
    "INTERNAL",
    "INVALID_DATA",
    "REVOKED_CONSENT",
    "CONFLICT",
  ];
  if (!known.includes(code)) throw new Error("Unknown safe error code");
  const [row] = await db
    .select({
      attempts: t.ingestionSyncJobs.attempts,
      maxAttempts: t.ingestionSyncJobs.maxAttempts,
    })
    .from(t.ingestionSyncJobs)
    .where(
      and(
        eq(t.ingestionSyncJobs.id, claim.id),
        eq(t.ingestionSyncJobs.state, "LEASED"),
        eq(t.ingestionSyncJobs.leaseToken, claim.leaseToken),
        eq(t.ingestionSyncJobs.attempts, claim.attempts),
        gt(t.ingestionSyncJobs.leaseUntil, now),
      ),
    )
    .limit(1);
  if (!row) return "STALE_LEASE";
  const permanent = PERMANENT.has(code) || row.attempts >= row.maxAttempts;
  const nextAttemptAt = permanent
    ? now
    : new Date(now.getTime() + retryDelayMs(row.attempts));
  const updated = await db
    .update(t.ingestionSyncJobs)
    .set({
      state: permanent ? "DEAD" : "PENDING",
      nextAttemptAt,
      leaseToken: null,
      leaseUntil: null,
      lastErrorCode: code,
      lastErrorAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(t.ingestionSyncJobs.id, claim.id),
        eq(t.ingestionSyncJobs.state, "LEASED"),
        eq(t.ingestionSyncJobs.leaseToken, claim.leaseToken),
        eq(t.ingestionSyncJobs.attempts, claim.attempts),
        gt(t.ingestionSyncJobs.leaseUntil, now),
      ),
    )
    .returning({ id: t.ingestionSyncJobs.id });
  return updated.length !== 1 ? "STALE_LEASE" : permanent ? "DEAD" : "RETRY";
}

/** Operational introspection only: no source payload, bank data or credentials. */
export async function getSyncJob(db: Db, id: string) {
  const [row] = await db
    .select()
    .from(t.ingestionSyncJobs)
    .where(eq(t.ingestionSyncJobs.id, id))
    .limit(1);
  return row ?? null;
}
