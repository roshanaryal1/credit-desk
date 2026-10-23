import "server-only";

import { and, count, eq, gte, sql } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

// Persistent rate limits in Postgres, so they hold across serverless
// instances and cannot be reset by clearing a cookie (SPEC 11, C12).

export async function hitsSince(
  db: Db,
  key: string,
  windowMs: number,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(t.rateLimitEvents)
    .where(
      and(
        eq(t.rateLimitEvents.key, key),
        gte(t.rateLimitEvents.createdAt, new Date(Date.now() - windowMs)),
      ),
    );
  return row?.n ?? 0;
}

export async function recordHit(db: Db, key: string): Promise<void> {
  await db.insert(t.rateLimitEvents).values({ key });
}

/**
 * Records one hit per key if every key is under its limit; otherwise records
 * nothing. Check and record happen in one transaction holding an advisory
 * lock per key, so concurrent callers cannot all slip under the limit.
 */
export async function takeAll(
  db: Db,
  limits: { key: string; max: number; windowMs: number }[],
): Promise<boolean> {
  const sorted = [...limits].sort((a, b) => (a.key < b.key ? -1 : 1));
  return db.transaction(async (tx) => {
    for (const l of sorted) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${l.key}))`);
    }
    for (const l of sorted) {
      const [row] = await tx
        .select({ n: count() })
        .from(t.rateLimitEvents)
        .where(
          and(
            eq(t.rateLimitEvents.key, l.key),
            gte(t.rateLimitEvents.createdAt, new Date(Date.now() - l.windowMs)),
          ),
        );
      if ((row?.n ?? 0) >= l.max) return false;
    }
    for (const l of sorted)
      await tx.insert(t.rateLimitEvents).values({ key: l.key });
    return true;
  });
}
