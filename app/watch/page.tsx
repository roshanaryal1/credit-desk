import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Chip, SeverityChip, type Tone } from "@/components/chips";
import { IncidentActions } from "@/components/incident-actions";
import { Loading, PageHeader, Section } from "@/components/page";
import { addDays, daysBetween } from "@/lib/dates";
import { DEMO_TODAY, HISTORY_DAYS } from "@/lib/demo";
import { currentDemoPersona } from "@/lib/demo-session";
import { businessDate, instant, money } from "@/lib/format";
import { incidentDetail, incidentsAsOf } from "@/lib/queries/watch";
import { WATCH_LABELS, type WatchRuleId } from "@/lib/watch/config";
import { cn } from "@/lib/utils";

export const metadata = { title: "Portfolio Watch" };

const START = addDays(DEMO_TODAY, -HISTORY_DAYS);
const STATUS: Record<string, { tone: Tone; label: string }> = {
  OPEN: { tone: "high", label: "Open" },
  REOPENED: { tone: "high", label: "Reopened" },
  ACKNOWLEDGED: { tone: "flagged", label: "Acknowledged" },
  RESOLVED: { tone: "neutral", label: "Resolved" },
};

export default function WatchPage({ searchParams }: PageProps<"/watch">) {
  return (
    <>
      <PageHeader
        title="Portfolio Watch"
        description="The same discipline after funding: rules run daily across the funded book. Move the date to watch incidents appear."
      />
      <Suspense fallback={<Loading label="Loading the book..." />}>
        <Watch searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function clampDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return DEMO_TODAY;
  // Reject impossible dates such as 2026-09-31 rather than letting them reach the database.
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
    return DEMO_TODAY;
  if (value < START) return START;
  if (value > DEMO_TODAY) return DEMO_TODAY;
  return value;
}

async function Watch({
  searchParams,
}: {
  searchParams: PageProps<"/watch">["searchParams"];
}) {
  await connection();
  const sp = await searchParams;
  const asOf = clampDate(sp.asOf);
  const selected = typeof sp.incident === "string" ? sp.incident : null;
  const incidents = await incidentsAsOf(asOf);
  const open = incidents.filter((i) => i.status !== "RESOLVED");
  const href = (date: string, incident?: string | null) =>
    `/watch?asOf=${clampDate(date)}${incident ? `&incident=${encodeURIComponent(incident)}` : ""}`;
  const clients = [
    ...new Map(incidents.map((i) => [i.clientId, i.clientName])).entries(),
  ];

  return (
    <>
      <div className="bg-card flex flex-col gap-3 rounded-md border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-muted-foreground text-sm">
            As of{" "}
            <span className="text-foreground text-lg font-semibold">
              {businessDate(asOf)}
            </span>
            , day {daysBetween(START, asOf)} of {HISTORY_DAYS}
          </p>
          <p className="text-muted-foreground text-sm">
            {open.length} open, {incidents.length - open.length} resolved
          </p>
        </div>
        <nav
          aria-label="Move through the history"
          className="flex flex-wrap gap-2 text-sm"
        >
          {[
            { label: "Start", to: START },
            { label: "Back a week", to: addDays(asOf, -7) },
            { label: "Back a day", to: addDays(asOf, -1) },
            { label: "Forward a day", to: addDays(asOf, 1) },
            { label: "Forward a week", to: addDays(asOf, 7) },
            { label: "Today", to: DEMO_TODAY },
          ].map((s) => (
            <Link
              key={s.label}
              href={href(s.to, selected)}
              scroll={false}
              className="hover:bg-accent focus-visible:ring-ring rounded-md border px-3 py-1.5 focus-visible:ring-2 focus-visible:outline-none"
            >
              {s.label}
            </Link>
          ))}
        </nav>
        <form action="/watch" className="flex items-center gap-2 text-sm">
          <label htmlFor="asOf" className="text-muted-foreground">
            Go to date
          </label>
          <input
            id="asOf"
            name="asOf"
            type="date"
            min={START}
            max={DEMO_TODAY}
            defaultValue={asOf}
            className="bg-background rounded-md border px-2 py-1"
          />
          <button className="hover:bg-accent rounded-md border px-3 py-1">
            Go
          </button>
        </form>
      </div>

      <Section
        title="Timeline by client"
        description="Each mark is an incident, placed on the day it was first detected."
      >
        <ul className="flex flex-col gap-3">
          {clients.map(([clientId, name]) => (
            <li
              key={clientId}
              className="grid gap-1 sm:grid-cols-[12rem_1fr] sm:items-center"
            >
              <span className="truncate text-sm">{name}</span>
              <div
                className="bg-muted relative h-5 rounded"
                role="img"
                aria-label={`Incidents for ${name}`}
              >
                {incidents
                  .filter((i) => i.clientId === clientId)
                  .map((i) => (
                    <span
                      key={i.id}
                      title={`${WATCH_LABELS[i.ruleId as WatchRuleId]}, ${businessDate(i.firstDetectedDate)}`}
                      className={cn(
                        "absolute top-1 h-3 w-1.5 rounded-sm",
                        i.severity === "HIGH"
                          ? "bg-destructive"
                          : i.severity === "MEDIUM"
                            ? "bg-chart-3"
                            : "bg-chart-5",
                      )}
                      style={{
                        left: `${(daysBetween(START, i.firstDetectedDate) / HISTORY_DAYS) * 100}%`,
                      }}
                    />
                  ))}
                <span
                  className="bg-foreground absolute top-0 h-5 w-px"
                  style={{
                    left: `${(daysBetween(START, asOf) / HISTORY_DAYS) * 100}%`,
                  }}
                  aria-hidden
                />
              </div>
            </li>
          ))}
        </ul>
        {clients.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No incidents yet at this date. Move forward to see the book change.
          </p>
        ) : null}
      </Section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Section title="Incidents" description="Newest first.">
          <ul className="bg-card divide-y rounded-md border text-sm">
            {incidents.map((i) => (
              <li
                key={i.id}
                className={i.id === selected ? "bg-accent" : undefined}
              >
                <Link
                  href={href(asOf, i.id)}
                  scroll={false}
                  className="hover:bg-accent/60 focus-visible:ring-ring grid gap-1 px-4 py-2.5 focus-visible:ring-2 focus-visible:outline-none sm:grid-cols-[1fr_auto]"
                >
                  <span className="font-medium">
                    {WATCH_LABELS[i.ruleId as WatchRuleId]}
                  </span>
                  <span className="flex gap-1.5 sm:justify-end">
                    <SeverityChip severity={i.severity} />
                    <Chip tone={STATUS[i.status]!.tone}>
                      {STATUS[i.status]!.label}
                    </Chip>
                  </span>
                  <span className="text-muted-foreground">
                    {i.clientName}
                    {i.debtorName ? `, ${i.debtorName}` : ""}
                  </span>
                  <span className="text-muted-foreground sm:text-right">
                    since {businessDate(i.firstDetectedDate)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
        {selected ? (
          <Suspense
            key={selected}
            fallback={<Loading label="Loading incident..." />}
          >
            <IncidentPanel incidentId={selected} asOf={asOf} />
          </Suspense>
        ) : null}
      </div>
    </>
  );
}

const DETAIL_LABELS: Record<string, (v: unknown) => string> = {
  recentMeanDays: (v) => `Recent days to pay: ${v}`,
  priorMeanDays: (v) => `Earlier days to pay: ${v}`,
  daysOverdue: (v) => `Days overdue: ${v}`,
  outstandingCents: (v) => `Outstanding advance: ${money(Number(v))}`,
  creditedCents: (v) => `Credited: ${money(Number(v))}`,
  shareBps: (v) => `Share of exposure: ${(Number(v) / 100).toFixed(1)}%`,
  fundsInUseCents: (v) => `Funds in use: ${money(Number(v))}`,
};

async function IncidentPanel({
  incidentId,
  asOf,
}: {
  incidentId: string;
  asOf: string;
}) {
  const canEdit = (await currentDemoPersona()) === "ANALYST";
  const data = await incidentDetail(incidentId, asOf);
  if (!data)
    return (
      <aside className="rounded-md border p-4 text-sm">
        Incident not found.
      </aside>
    );
  const { incident, latestDetection, detectionCount, events, explained } = data;
  const details = (latestDetection?.details ?? {}) as Record<string, unknown>;
  const status = events.at(-1)?.status ?? "OPEN";
  return (
    <aside className="bg-card flex flex-col gap-4 rounded-md border p-4 xl:sticky xl:top-4">
      <header>
        <h2 className="text-lg font-semibold">
          {WATCH_LABELS[incident.ruleId as WatchRuleId]}
        </h2>
        <p className="text-muted-foreground text-sm">
          First detected {businessDate(incident.firstDetectedDate)}, seen on{" "}
          {detectionCount} days up to {businessDate(asOf)}.
        </p>
      </header>
      <section className="flex flex-col gap-1 text-sm">
        <h3 className="font-semibold">What changed</h3>
        <ul className="list-disc pl-5">
          {Object.entries(details)
            .filter(([k]) => DETAIL_LABELS[k])
            .map(([k, v]) => (
              <li key={k}>{DETAIL_LABELS[k]!(v)}</li>
            ))}
        </ul>
        {Array.isArray(details.evidenceIds) &&
        details.evidenceIds.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            Evidence: {(details.evidenceIds as string[]).slice(0, 8).join(", ")}
          </p>
        ) : null}
      </section>
      {incident.severity === "HIGH" ? (
        <section className="flex flex-col gap-1 text-sm">
          <h3 className="font-semibold">Agent explanation</h3>
          {explained &&
          explained.run.asOfDate &&
          asOf < explained.run.asOfDate ? (
            <p className="text-muted-foreground">
              The explanation was written as of{" "}
              {businessDate(explained.run.asOfDate)}. Move to that date to see
              it, so it does not describe a later state of the book than the one
              on screen.
            </p>
          ) : explained &&
            explained.explanation.validationStatus === "PASSED" ? (
            <>
              <p>{explained.explanation.summary}</p>
              <ul className="text-muted-foreground list-disc pl-5">
                {explained.explanation.claims.map((c, i) => (
                  <li key={i}>
                    {c.text}{" "}
                    <span className="text-xs">
                      ({c.evidenceIds.join(", ")})
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground text-xs">
                {explained.run.model}, prompt {explained.run.promptVersion}.
                Citations and figures were checked against the records.
              </p>
            </>
          ) : explained ? (
            <p>Explanation unavailable, see what changed above.</p>
          ) : (
            <p className="text-muted-foreground">
              No explanation has been generated for this incident yet.
            </p>
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-1 text-sm">
        <h3 className="font-semibold">History</h3>
        <ol className="flex flex-col gap-1">
          {events.map((e) => (
            <li key={e.id}>
              <Chip tone={STATUS[e.status]!.tone}>
                {STATUS[e.status]!.label}
              </Chip>{" "}
              {e.actor === "watch" ? "by the watch rules" : `by ${e.actor}`},{" "}
              {instant(e.occurredAt)}
              {e.note ? (
                <span className="text-muted-foreground block">
                  &ldquo;{e.note}&rdquo;
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
      {canEdit ? (
        <IncidentActions incidentId={incident.id} status={status} />
      ) : (
        <p className="text-muted-foreground text-xs">
          Observation only: this demo perspective cannot acknowledge or resolve
          incidents.
        </p>
      )}
    </aside>
  );
}
