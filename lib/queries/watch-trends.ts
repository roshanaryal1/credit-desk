import "server-only";

import { inArray, lte } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { watchTrends } from "@/lib/watch/trends";

export async function getWatchTrends(db: Db, asOf: string) {
  const incidents = await db.select({
    id: t.incidents.id,
    firstDetectedDate: t.incidents.firstDetectedDate,
    severity: t.incidents.severity,
  }).from(t.incidents).where(lte(t.incidents.firstDetectedDate, asOf));
  const ids = incidents.map((i) => i.id);
  const actions = ids.length
    ? await db.select({
        id: t.incidentEvents.id,
        incidentId: t.incidentEvents.incidentId,
        status: t.incidentEvents.status,
        occurredAt: t.incidentEvents.occurredAt,
      }).from(t.incidentEvents).where(inArray(t.incidentEvents.incidentId, ids))
    : [];
  return watchTrends(asOf, incidents, actions);
}
