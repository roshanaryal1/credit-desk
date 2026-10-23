import "server-only";

import { desc, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

export const AUDIT_PAGE_SIZE = 100;

/**
 * Pages are keyed by the id of the last event shown. The boundary timestamp is
 * looked up in the database, so it keeps Postgres's microsecond precision (a
 * JavaScript Date would truncate it and could skip events).
 */
export function decodeCursor(value: unknown): string | null {
  return typeof value === "string" && /^aud_[A-Za-z0-9_:.-]{1,200}$/.test(value)
    ? value
    : null;
}

/** Rows strictly older than the cursor event, by (created_at, id). */
export const olderThan = (cursorId: string) =>
  sql`(${t.auditEvents.createdAt}, ${t.auditEvents.id}) < (select created_at, id from audit_events where id = ${cursorId})`;

/** One page of audit events, newest first, with a cursor for the next page. */
export async function listAuditEvents(before: string | null) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(t.auditEvents)
    .where(before ? olderThan(before) : undefined)
    .orderBy(desc(t.auditEvents.createdAt), desc(t.auditEvents.id))
    .limit(AUDIT_PAGE_SIZE + 1);
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  return {
    events: page,
    next: rows.length > AUDIT_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
  };
}
