import "server-only";

import { asc, desc, eq, lte } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

/** Incidents first detected on or before the as-of date, with current status. */
export async function incidentsAsOf(asOf: string) {
  const db = await getDb();
  const rows = await db
    .select({
      incident: t.incidents,
      clientName: t.clients.name,
      debtorName: t.debtors.name,
    })
    .from(t.incidents)
    .innerJoin(t.clients, eq(t.incidents.clientId, t.clients.id))
    .leftJoin(t.debtors, eq(t.incidents.debtorId, t.debtors.id))
    .where(lte(t.incidents.firstDetectedDate, asOf))
    .orderBy(desc(t.incidents.firstDetectedDate), asc(t.incidents.id));
  const events = await db
    .select()
    .from(t.incidentEvents)
    .orderBy(asc(t.incidentEvents.occurredAt));
  const latest = new Map<string, (typeof events)[number]>();
  for (const e of events) latest.set(e.incidentId, e);
  return rows.map((r) => ({
    ...r.incident,
    clientName: r.clientName,
    debtorName: r.debtorName,
    status: latest.get(r.incident.id)?.status ?? "OPEN",
    statusAt: latest.get(r.incident.id)?.occurredAt ?? null,
  }));
}

export async function incidentDetail(incidentId: string, asOf: string) {
  const db = await getDb();
  const [incident] = await db
    .select()
    .from(t.incidents)
    .where(eq(t.incidents.id, incidentId));
  if (!incident) return null;
  const detections = await db
    .select()
    .from(t.watchDetections)
    .where(eq(t.watchDetections.incidentKey, incident.incidentKey))
    .orderBy(desc(t.watchDetections.asOfDate));
  const visible = detections.filter((d) => d.asOfDate <= asOf);
  const events = await db
    .select()
    .from(t.incidentEvents)
    .where(eq(t.incidentEvents.incidentId, incidentId))
    .orderBy(asc(t.incidentEvents.occurredAt));
  return {
    incident,
    latestDetection: visible[0] ?? null,
    detectionCount: visible.length,
    events,
  };
}
