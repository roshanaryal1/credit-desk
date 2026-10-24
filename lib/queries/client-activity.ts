import { and, asc, eq, inArray, lte } from "drizzle-orm";

import { daysBetween } from "@/lib/dates";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

/** Synthetic client-scoped event. No production client authorization here. */
export interface ClientActivity {
  id: string;
  kind:
    | "BATCH"
    | "FUNDING"
    | "DECISION"
    | "INCIDENT"
    | "INCIDENT_ACTION"
    | "CASE_EVENT";
  businessDate: string;
  occurredAt: string | null;
  title: string;
  detail: string;
  sourceId: string;
  href: string;
}

export function nzDateOfInstant(date: Date): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error("Invalid activity timestamp");
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Pacific/Auckland",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const value = (key: "year" | "month" | "day") =>
    parts.find((p) => p.type === key)?.value;
  return value("year") + "-" + value("month") + "-" + value("day");
}

/** Stable page boundaries; no client rows are queried before scoping. */
export function paginateClientActivity(
  entries: ClientActivity[],
  page: number,
  pageSize: number,
) {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 10000 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 50
  ) {
    throw new Error("Invalid activity pagination");
  }
  const sorted = [...entries].sort(
    (a, b) =>
      b.businessDate.localeCompare(a.businessDate) ||
      (b.occurredAt ?? "").localeCompare(a.occurredAt ?? "") ||
      a.kind.localeCompare(b.kind) ||
      a.id.localeCompare(b.id),
  );
  return {
    items: sorted.slice((page - 1) * pageSize, page * pageSize),
    page,
    total: sorted.length,
    totalPages: Math.ceil(sorted.length / pageSize),
  };
}

export async function getClientActivity(
  db: Db,
  clientId: string,
  asOf: string,
  page = 1,
  pageSize = 15,
) {
  daysBetween(asOf, asOf);
  if (!clientId.trim()) return null;
  const [client] = await db
    .select({ id: t.clients.id })
    .from(t.clients)
    .where(eq(t.clients.id, clientId))
    .limit(1);
  if (!client) return null;
  const [batches, invoices, incidents, cases] = await Promise.all([
    db
      .select()
      .from(t.batches)
      .where(
        and(
          eq(t.batches.clientId, clientId),
          lte(t.batches.submittedDate, asOf),
        ),
      ),
    db
      .select({ id: t.invoices.id })
      .from(t.invoices)
      .where(eq(t.invoices.clientId, clientId)),
    db
      .select()
      .from(t.incidents)
      .where(
        and(
          eq(t.incidents.clientId, clientId),
          lte(t.incidents.firstDetectedDate, asOf),
        ),
      ),
    db
      .select({ id: t.creditCases.id })
      .from(t.creditCases)
      .where(eq(t.creditCases.clientId, clientId)),
  ]);
  const invoiceIds = invoices.map((r) => r.id);
  const incidentIds = incidents.map((r) => r.id);
  const caseIds = cases.map((r) => r.id);
  const [fundings, decisions, incidentActions, caseEvents] = await Promise.all([
    invoiceIds.length
      ? db
          .select()
          .from(t.fundings)
          .where(
            and(
              inArray(t.fundings.invoiceId, invoiceIds),
              lte(t.fundings.fundedDate, asOf),
            ),
          )
      : [],
    invoiceIds.length
      ? db
          .select()
          .from(t.decisions)
          .where(inArray(t.decisions.invoiceId, invoiceIds))
      : [],
    incidentIds.length
      ? db
          .select()
          .from(t.incidentEvents)
          .where(inArray(t.incidentEvents.incidentId, incidentIds))
      : [],
    caseIds.length
      ? db
          .select()
          .from(t.creditCaseEvents)
          .where(inArray(t.creditCaseEvents.caseId, caseIds))
      : [],
  ]);

  const events: ClientActivity[] = batches.map((row) => ({
    id: "batch:" + row.id,
    kind: "BATCH",
    businessDate: row.submittedDate,
    occurredAt: null,
    title: "Invoice batch submitted",
    detail: "Synthetic submission record " + row.id,
    sourceId: row.id,
    href: "/batches/" + encodeURIComponent(row.id),
  }));
  for (const row of fundings)
    events.push({
      id: "funding:" + row.id,
      kind: "FUNDING",
      businessDate: row.fundedDate,
      occurredAt: null,
      title: "Historical synthetic funding",
      detail: "Recorded synthetic advance; not a new disbursement",
      sourceId: row.id,
      href: "/clients/" + encodeURIComponent(clientId),
    });
  for (const row of incidents)
    events.push({
      id: "incident:" + row.id,
      kind: "INCIDENT",
      businessDate: row.firstDetectedDate,
      occurredAt: null,
      title: "Risk exception detected",
      detail: row.ruleId.replaceAll("_", " ") + " · " + row.severity,
      sourceId: row.id,
      href:
        "/watch?incident=" +
        encodeURIComponent(row.id) +
        "&asOf=" +
        encodeURIComponent(asOf),
    });
  for (const row of decisions) {
    const date = nzDateOfInstant(row.decidedAt);
    if (date > asOf) continue;
    events.push({
      id: "decision:" + row.id,
      kind: "DECISION",
      businessDate: date,
      occurredAt: row.decidedAt.toISOString(),
      title: "Invoice review decision",
      detail:
        row.decision +
        (row.simulated ? " · simulated cohort" : " · demo session"),
      sourceId: row.id,
      href: "/trust/replay/" + encodeURIComponent(row.id),
    });
  }
  for (const row of incidentActions) {
    const date = nzDateOfInstant(row.occurredAt);
    if (date > asOf) continue;
    events.push({
      id: "incident-action:" + row.id,
      kind: "INCIDENT_ACTION",
      businessDate: date,
      occurredAt: row.occurredAt.toISOString(),
      title: "Incident status changed",
      detail: row.status,
      sourceId: row.id,
      href:
        "/watch?incident=" +
        encodeURIComponent(row.incidentId) +
        "&asOf=" +
        encodeURIComponent(asOf),
    });
  }
  for (const row of caseEvents) {
    const date = nzDateOfInstant(row.occurredAt);
    if (date > asOf) continue;
    events.push({
      id: "case:" + row.id,
      kind: "CASE_EVENT",
      businessDate: date,
      occurredAt: row.occurredAt.toISOString(),
      title: "Credit case history",
      detail: row.toState + " · " + row.action,
      sourceId: row.id,
      href: "/queue",
    });
  }
  return { asOf, clientId, ...paginateClientActivity(events, page, pageSize) };
}
