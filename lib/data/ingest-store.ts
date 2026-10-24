import "server-only";

import { createHash } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

import {
  knownSnapshotAsOf,
  reconcileObservations,
  type SourceKind,
  type SourceObservation,
} from "./observations";

export interface SourceConnection {
  sourceKind: SourceKind;
  connectionId: string;
  clientId: string;
}

function stableId(input: SourceObservation<unknown>): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.sourceKind,
        input.connectionId,
        input.clientId,
        input.eventId,
      ]),
    )
    .digest("hex");
}

function sameSource(
  connection: SourceConnection,
  observation: SourceObservation<unknown>,
): boolean {
  return (
    connection.sourceKind === observation.sourceKind &&
    connection.connectionId === observation.connectionId &&
    connection.clientId === observation.clientId
  );
}

function readEvent(
  row: typeof t.ingestionEvents.$inferSelect,
): SourceObservation<unknown> {
  return {
    sourceKind: row.sourceKind as SourceKind,
    connectionId: row.connectionId,
    clientId: row.clientId,
    eventId: row.eventId,
    entityId: row.entityId,
    effectiveDate: row.effectiveDate,
    observedAt: row.observedAt.toISOString(),
    payload: row.payload,
  };
}

/**
 * Atomically writes source facts and advances the connection checkpoint.
 * The UNIQUE index is the actual concurrency guard. A concurrent conflicting
 * write is rejected after reading the winning row.
 */
export async function recordSourceBatch(
  db: Db,
  connection: SourceConnection,
  incoming: SourceObservation<unknown>[],
  syncedAt: Date,
  cursor: string | null,
): Promise<{ inserted: number; duplicates: number }> {
  if (
    Number.isNaN(syncedAt.getTime()) ||
    (cursor !== null && cursor.length > 2048)
  )
    throw new Error("Invalid sync timestamp or cursor");
  const unique = reconcileObservations([], incoming);
  if (incoming.some((x) => !sameSource(connection, x)))
    throw new Error("Source connection/client mismatch");
  if (
    unique.observations.some(
      (x) => Date.parse(x.observedAt) > syncedAt.getTime(),
    )
  )
    throw new Error("Source cannot observe events after its sync timestamp");

  return db.transaction(async (tx) => {
    let inserted = 0;
    let duplicates = unique.duplicates;
    for (const event of unique.observations) {
      const id = stableId(event);
      const recorded = await tx
        .insert(t.ingestionEvents)
        .values({
          id,
          sourceKind: event.sourceKind,
          connectionId: event.connectionId,
          clientId: event.clientId,
          eventId: event.eventId,
          entityId: event.entityId,
          effectiveDate: event.effectiveDate,
          observedAt: new Date(event.observedAt),
          payload: event.payload,
        })
        .onConflictDoNothing()
        .returning({ id: t.ingestionEvents.id });
      if (recorded.length) {
        inserted++;
        continue;
      }
      const [prior] = await tx
        .select()
        .from(t.ingestionEvents)
        .where(eq(t.ingestionEvents.id, id))
        .limit(1);
      if (!prior) throw new Error("Conflicting source identity is unavailable");
      reconcileObservations(
        [readEvent(prior)],
        [{ ...event, observedAt: new Date(event.observedAt).toISOString() }],
      );
      duplicates++;
    }
    await tx
      .insert(t.ingestionCheckpoints)
      .values({
        ...connection,
        cursor,
        lastSuccessAt: syncedAt,
        updatedAt: syncedAt,
      })
      .onConflictDoUpdate({
        target: [
          t.ingestionCheckpoints.sourceKind,
          t.ingestionCheckpoints.connectionId,
          t.ingestionCheckpoints.clientId,
        ],
        set: {
          cursor,
          lastSuccessAt: syncedAt,
          updatedAt: syncedAt,
        },
      });
    return { inserted, duplicates };
  });
}

/** Records a failed sync without deleting previous successful checkpoints. */
export async function recordSourceFailure(
  db: Db,
  connection: SourceConnection,
  failedAt: Date,
): Promise<void> {
  if (Number.isNaN(failedAt.getTime()))
    throw new Error("Invalid failure timestamp");
  await db
    .insert(t.ingestionCheckpoints)
    .values({
      ...connection,
      lastFailureAt: failedAt,
      updatedAt: failedAt,
    })
    .onConflictDoUpdate({
      target: [
        t.ingestionCheckpoints.sourceKind,
        t.ingestionCheckpoints.connectionId,
        t.ingestionCheckpoints.clientId,
      ],
      set: {
        lastFailureAt: failedAt,
        updatedAt: failedAt,
      },
    });
}

export async function getSourceCheckpoint(
  db: Db,
  connection: SourceConnection,
) {
  const [row] = await db
    .select()
    .from(t.ingestionCheckpoints)
    .where(
      and(
        eq(t.ingestionCheckpoints.sourceKind, connection.sourceKind),
        eq(t.ingestionCheckpoints.connectionId, connection.connectionId),
        eq(t.ingestionCheckpoints.clientId, connection.clientId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Read only the source's client partition and delegate historical replay. */
export async function sourceSnapshot(
  db: Db,
  connection: SourceConnection,
  businessAsOf: string,
  knowledgeCutoff: string,
): Promise<SourceObservation<unknown>[]> {
  const rows = await db
    .select()
    .from(t.ingestionEvents)
    .where(
      and(
        eq(t.ingestionEvents.clientId, connection.clientId),
        eq(t.ingestionEvents.sourceKind, connection.sourceKind),
        eq(t.ingestionEvents.connectionId, connection.connectionId),
        lte(t.ingestionEvents.effectiveDate, businessAsOf),
        lte(t.ingestionEvents.observedAt, new Date(knowledgeCutoff)),
      ),
    );
  return knownSnapshotAsOf(
    rows.map(readEvent),
    businessAsOf,
    knowledgeCutoff,
    connection.clientId,
  );
}
