import "server-only";

import { desc } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

export async function listAuditEvents(limit = 200) {
  const db = await getDb();
  return db
    .select()
    .from(t.auditEvents)
    .orderBy(desc(t.auditEvents.createdAt), desc(t.auditEvents.id))
    .limit(limit);
}
