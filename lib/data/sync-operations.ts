import "server-only";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

import { sourceHealth, type SourceHealth } from "./observations";

type SyncJob = typeof t.ingestionSyncJobs.$inferSelect;
type Checkpoint = typeof t.ingestionCheckpoints.$inferSelect;

export type SyncCondition =
  | "DEAD_LETTER"
  | "LEASE_EXPIRED"
  | "RETRY_DUE"
  | "RETRY_WAIT"
  | "QUEUED"
  | "IN_PROGRESS"
  | "SUCCEEDED"
  | "NOT_SCHEDULED";

export interface SyncOperationalRow {
  key: string;
  clientId: string;
  sourceKind: "ACCOUNTING" | "BANK";
  connectionId: string;
  condition: SyncCondition;
  freshness: SourceHealth;
  attempts: number;
  maxAttempts: number | null;
  nextAttemptAt: string | null;
  leaseUntil: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastSafeError: string | null;
  exception: string | null;
}

const SAFE_ERRORS = new Set([
  "TIMEOUT",
  "NETWORK",
  "RATE_LIMIT",
  "PROVIDER_DOWN",
  "INTERNAL",
  "INVALID_DATA",
  "REVOKED_CONSENT",
  "CONFLICT",
]);

const keyOf = (row: {
  sourceKind: string;
  connectionId: string;
  clientId: string;
}) => JSON.stringify([
  row.clientId,
  row.sourceKind,
  row.connectionId,
]);

function validDate(date: Date): boolean {
  return date instanceof Date && Number.isFinite(date.getTime());
}

/**
 * Synthetic operational snapshot. No external requests or DB writes.
 * Checkpoints/jobs are mutable operational tables, NOT an event-sourced
 * historic ledger: passing a past time never claims point-in-time replay.
 */
export function projectSyncOperations(
  jobs: readonly SyncJob[],
  checkpoints: readonly Checkpoint[],
  now: Date,
  maxAgeMinutes = 1440,
): SyncOperationalRow[] {
  if (!validDate(now)) throw new Error("Invalid UTC observation time");
  if (!Number.isSafeInteger(maxAgeMinutes) || maxAgeMinutes < 1) {
    throw new Error("Invalid freshness threshold");
  }
  const at = now.getTime();
  const current = now.toISOString();
  const keys = new Map<
    string,
    { job?: SyncJob; checkpoint?: Checkpoint }
  >();
  for (const job of jobs) {
    const key = keyOf(job);
    if (keys.get(key)?.job) throw new Error("Duplicate synthetic sync job");
    keys.set(key, { ...keys.get(key), job });
  }
  for (const checkpoint of checkpoints) {
    const key = keyOf(checkpoint);
    if (keys.get(key)?.checkpoint) {
      throw new Error("Duplicate synthetic source checkpoint");
    }
    keys.set(key, { ...keys.get(key), checkpoint });
  }
  return [...keys.entries()].map(([key, item]) => {
    const src = item.job ?? item.checkpoint!;
    if (
      !["ACCOUNTING", "BANK"].includes(src.sourceKind) ||
      !src.clientId.trim() ||
      !src.connectionId.trim()
    ) {
      throw new Error("Invalid scoped source");
    }
    const job = item.job;
    const checkpoint = item.checkpoint;
    const futureCheckpoint =
      checkpoint !== undefined && [
        checkpoint.lastSuccessAt,
        checkpoint.lastFailureAt,
      ].some((date) => date !== null && date.getTime() > at);
    const latestSuccess = futureCheckpoint
      ? null
      : checkpoint?.lastSuccessAt ?? null;
    const latestFailure = futureCheckpoint
      ? null
      : checkpoint?.lastFailureAt ?? null;
    const freshness = futureCheckpoint
      ? "UNKNOWN"
      : sourceHealth(
          current,
          latestSuccess?.toISOString() ?? null,
          latestFailure?.toISOString() ?? null,
          maxAgeMinutes,
        );
    let condition: SyncCondition = "NOT_SCHEDULED";
    if (job) {
      if (job.state === "DEAD") {
        condition = "DEAD_LETTER";
      } else if (job.state === "LEASED") {
        condition =
          job.leaseUntil === null || job.leaseUntil.getTime() <= at
            ? "LEASE_EXPIRED"
            : "IN_PROGRESS";
      } else if (job.state === "PENDING") {
        condition =
          job.attempts > 0
            ? job.nextAttemptAt.getTime() <= at
              ? "RETRY_DUE"
              : "RETRY_WAIT"
            : "QUEUED";
      } else if (job.state === "SUCCEEDED") {
        condition = "SUCCEEDED";
      } else {
        throw new Error("Unknown synthetic sync job state");
      }
    }
    const exception =
      futureCheckpoint ? "FUTURE_CHECKPOINT" :
      condition === "DEAD_LETTER" ? "DEAD_LETTER" :
      condition === "LEASE_EXPIRED" ? "LEASE_EXPIRED" :
      condition === "RETRY_DUE" ? "RETRY_DUE" :
      freshness === "ERROR" ? "SOURCE_ERROR" :
      freshness === "STALE" ? "SOURCE_STALE" :
      freshness === "UNKNOWN" ? "SOURCE_UNKNOWN" :
      null;
    return {
      key,
      clientId: src.clientId,
      sourceKind: src.sourceKind as "ACCOUNTING" | "BANK",
      connectionId: src.connectionId,
      condition,
      freshness,
      attempts: job?.attempts ?? 0,
      maxAttempts: job?.maxAttempts ?? null,
      nextAttemptAt: job?.nextAttemptAt.toISOString() ?? null,
      leaseUntil: job?.leaseUntil?.toISOString() ?? null,
      lastSuccessAt: latestSuccess?.toISOString() ?? null,
      lastFailureAt: latestFailure?.toISOString() ?? null,
      lastSafeError:
        job?.lastErrorCode && SAFE_ERRORS.has(job.lastErrorCode)
          ? job.lastErrorCode
          : job?.lastErrorCode ? "INTERNAL" : null,
      exception,
    };
  }).sort((a, b) =>
    a.clientId.localeCompare(b.clientId) ||
    a.sourceKind.localeCompare(b.sourceKind) ||
    a.connectionId.localeCompare(b.connectionId),
  );
}

export async function readSyntheticSyncOperations(db: Db, observedAt: Date) {
  if (!validDate(observedAt)) throw new Error("Invalid observation time");
  const [jobs, checkpoints, clients] = await Promise.all([
    db.select().from(t.ingestionSyncJobs),
    db.select().from(t.ingestionCheckpoints),
    db.select({ id: t.clients.id, name: t.clients.name }).from(t.clients),
  ]);
  const rows = projectSyncOperations(jobs, checkpoints, observedAt);
  const names = new Map(clients.map((client) => [
    client.id,
    client.name,
  ]));
  for (const row of rows) {
    if (!names.has(row.clientId)) {
      throw new Error("Sync source has an unknown client partition");
    }
  }
  return {
    observedAt: observedAt.toISOString(),
    sourceMode: "SYNTHETIC_ONLY" as const,
    counts: {
      connections: rows.length,
      deadLetters: rows.filter((row) => row.condition === "DEAD_LETTER").length,
      expiredLeases: rows.filter((row) => row.condition === "LEASE_EXPIRED").length,
      dueRetries: rows.filter((row) => row.condition === "RETRY_DUE").length,
      sourceErrors: rows.filter((row) => row.freshness === "ERROR").length,
      unknownSources: rows.filter((row) => row.freshness === "UNKNOWN").length,
    },
    rows: rows.map((row) => ({
      ...row,
      clientName: names.get(row.clientId)!,
    })),
  };
}
