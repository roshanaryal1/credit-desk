import { and, desc, eq } from "drizzle-orm";

import { addDays } from "@/lib/dates";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

import { bookAsOf, loadBookSource, type BookSource } from "./book";
import { CONFIG_VERSION, WATCH_SEVERITY } from "./config";
import { runWatchRules } from "./rules";
import type { Detection } from "./types";

// Runs the watch rules for a date and records detections, incidents and
// lifecycle events (SPEC 7). Idempotent: a date already run adds nothing.

/** System events are stamped at 06:00 NZDT (17:00 UTC the day before) on the as-of date. */
const systemInstant = (asOf: string) =>
  new Date(`${addDays(asOf, -1)}T17:00:00Z`);

export async function runWatchForDate(
  db: Db,
  asOf: string,
  source?: BookSource,
): Promise<Detection[]> {
  const src = source ?? (await loadBookSource(db));
  const detections = runWatchRules(bookAsOf(src, asOf));
  // Each detection and its incident changes commit together, so a failure
  // part-way leaves nothing behind and the date can simply be re-run.
  for (const d of detections)
    await db.transaction((tx) => recordDetection(tx as unknown as Db, d, asOf));
  return detections;
}

async function recordDetection(db: Db, d: Detection, asOf: string) {
  const inserted = await db
    .insert(t.watchDetections)
    .values({
      id: `det_${d.incidentKey}_${asOf}`,
      ruleId: d.ruleId,
      incidentKey: d.incidentKey,
      asOfDate: asOf,
      details: { ...d.details, evidenceIds: d.evidenceIds },
      configVersion: CONFIG_VERSION,
    })
    .onConflictDoNothing()
    .returning({ id: t.watchDetections.id });
  if (inserted.length === 0) return;

  const [incident] = await db
    .select()
    .from(t.incidents)
    .where(eq(t.incidents.incidentKey, d.incidentKey));
  if (!incident) {
    const id = `inc_${d.incidentKey}`;
    await db.insert(t.incidents).values({
      id,
      incidentKey: d.incidentKey,
      ruleId: d.ruleId,
      clientId: d.clientId,
      debtorId: d.debtorId,
      fundingId: d.fundingId,
      severity: WATCH_SEVERITY[d.ruleId],
      firstDetectedDate: asOf,
      lastDetectedDate: asOf,
    });
    await db.insert(t.incidentEvents).values({
      id: `iev_${id}_${asOf}_open`,
      incidentId: id,
      status: "OPEN",
      note: null,
      actor: "watch",
      occurredAt: systemInstant(asOf),
    });
    return;
  }
  if (asOf > incident.lastDetectedDate) {
    await db
      .update(t.incidents)
      .set({ lastDetectedDate: asOf })
      .where(eq(t.incidents.id, incident.id));
  }
  if (asOf < incident.firstDetectedDate) {
    // A backfill found an earlier detection: the incident opened then.
    await db
      .update(t.incidents)
      .set({ firstDetectedDate: asOf })
      .where(eq(t.incidents.id, incident.id));
    await db
      .insert(t.incidentEvents)
      .values({
        id: `iev_${incident.id}_${asOf}_open`,
        incidentId: incident.id,
        status: "OPEN",
        note: "Opened on an earlier date found by a backfill run.",
        actor: "watch",
        occurredAt: systemInstant(asOf),
      })
      .onConflictDoNothing();
    return;
  }
  // A detection after a resolution reopens the incident (SPEC 7).
  const [latest] = await db
    .select()
    .from(t.incidentEvents)
    .where(eq(t.incidentEvents.incidentId, incident.id))
    .orderBy(desc(t.incidentEvents.occurredAt))
    .limit(1);
  if (
    latest?.status === "RESOLVED" &&
    systemInstant(asOf) > latest.occurredAt
  ) {
    await db
      .insert(t.incidentEvents)
      .values({
        id: `iev_${incident.id}_${asOf}_reopen`,
        incidentId: incident.id,
        status: "REOPENED",
        note: "Detected again after it was resolved.",
        actor: "watch",
        occurredAt: systemInstant(asOf),
      })
      .onConflictDoNothing();
  }
}

/** Runs every date in [from, to] in order, loading the book once. */
export async function runWatchRange(db: Db, from: string, to: string) {
  const src = await loadBookSource(db);
  let total = 0;
  for (let d = from; d <= to; d = addDays(d, 1))
    total += (await runWatchForDate(db, d, src)).length;
  return total;
}

/** Status of an incident: the latest lifecycle event. */
export async function incidentStatus(db: Db, incidentId: string) {
  const [latest] = await db
    .select({ status: t.incidentEvents.status })
    .from(t.incidentEvents)
    .where(and(eq(t.incidentEvents.incidentId, incidentId)))
    .orderBy(desc(t.incidentEvents.occurredAt))
    .limit(1);
  return latest?.status ?? "OPEN";
}
