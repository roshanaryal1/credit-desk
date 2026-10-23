import "server-only";

import { and, count, eq, gte } from "drizzle-orm";

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

/** Records one hit per key if every key is under its limit; otherwise records nothing. */
export async function takeAll(
  db: Db,
  limits: { key: string; max: number; windowMs: number }[],
): Promise<boolean> {
  for (const l of limits) {
    if ((await hitsSince(db, l.key, l.windowMs)) >= l.max) return false;
  }
  for (const l of limits) await recordHit(db, l.key);
  return true;
}
