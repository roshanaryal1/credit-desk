import "server-only";

import { and, desc, eq, lt, or } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

export const AUDIT_PAGE_SIZE = 100;

export interface AuditCursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(c: AuditCursor): string {
  return `${c.createdAt.toISOString()}~${c.id}`;
}

export function decodeCursor(value: unknown): AuditCursor | null {
  if (typeof value !== "string") return null;
  const [at, id] = value.split("~");
  const createdAt = new Date(at ?? "");
  return id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null;
}

/** One page of audit events, newest first, with a cursor for the next page. */
export async function listAuditEvents(before: AuditCursor | null) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(t.auditEvents)
    .where(
      before
        ? or(
            lt(t.auditEvents.createdAt, before.createdAt),
            and(
              eq(t.auditEvents.createdAt, before.createdAt),
              lt(t.auditEvents.id, before.id),
            ),
          )
        : undefined,
    )
    .orderBy(desc(t.auditEvents.createdAt), desc(t.auditEvents.id))
    .limit(AUDIT_PAGE_SIZE + 1);
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  const last = page.at(-1);
  return {
    events: page,
    next:
      rows.length > AUDIT_PAGE_SIZE && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}
