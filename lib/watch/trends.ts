import { addDays, daysBetween } from "@/lib/dates";

export interface TrendIncident {
  id: string;
  firstDetectedDate: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
}
export interface TrendAction {
  incidentId: string;
  id: string;
  status: string;
  occurredAt: Date;
}

function nzDay(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid trend action time");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Pacific/Auckland",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const part = (kind: "year" | "month" | "day") =>
    parts.find((p) => p.type === kind)?.value;
  return part("year") + "-" + part("month") + "-" + part("day");
}

/** Historic display statistics only, not policy escalation or notifications. */
export function watchTrends(
  asOf: string,
  incidents: TrendIncident[],
  actions: TrendAction[],
) {
  daysBetween(asOf, asOf);
  const visible = incidents.filter((incident) => {
    daysBetween(incident.firstDetectedDate, incident.firstDetectedDate);
    return incident.firstDetectedDate <= asOf;
  });
  const byId = new Map(visible.map((i) => [i.id, i]));
  const latest = new Map<string, TrendAction>();
  const orderedActions = [...actions].sort((a, b) =>
    a.occurredAt.getTime() - b.occurredAt.getTime() ||
    a.id.localeCompare(b.id),
  );
  for (const action of orderedActions) {
    if (!byId.has(action.incidentId) || nzDay(action.occurredAt) > asOf) continue;
    latest.set(action.incidentId, action);
  }
  const unresolved = visible.filter((i) => latest.get(i.id)?.status !== "RESOLVED");
  const settled = visible.flatMap((i) => {
    const action = latest.get(i.id);
    return action?.status === "RESOLVED"
      ? [daysBetween(i.firstDetectedDate, nzDay(action.occurredAt))]
      : [];
  });
  const last30 = addDays(asOf, -29);
  const prev30 = addDays(asOf, -59);
  const current = visible.filter((i) => i.firstDetectedDate >= last30);
  const previous = visible.filter((i) =>
    i.firstDetectedDate >= prev30 && i.firstDetectedDate < last30,
  );
  const timeline = Array.from({ length: 14 }, (_, index) => {
    const date = addDays(asOf, index - 13);
    const dayIncidents = visible.filter((i) => i.firstDetectedDate === date);
    return {
      date,
      count: dayIncidents.length,
      high: dayIncidents.filter((i) => i.severity === "HIGH").length,
      incidentIds: dayIncidents.map((i) => i.id).sort(),
    };
  });
  return {
    asOf,
    incidentsTotal: visible.length,
    unresolved: unresolved.length,
    resolved: visible.length - unresolved.length,
    highUnresolved: unresolved.filter((i) => i.severity === "HIGH").length,
    detectedLast30: current.length,
    detectedPrior30: previous.length,
    meanDaysToResolution: settled.length
      ? settled.reduce((sum, n) => sum + n, 0) / settled.length
      : null,
    meanResolutionSample: settled.length,
    timeline,
  };
}
