import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Chip } from "@/components/chips";
import { Loading } from "@/components/page";
import { DEMO_TODAY } from "@/lib/demo";
import { businessDate, money, percent } from "@/lib/format";
import { listBatches, listClients } from "@/lib/queries/book";
import { decisionRecords } from "@/lib/queries/trust";
import { incidentsAsOf } from "@/lib/queries/watch";
import { agreementReport } from "@/lib/trust/agreement";

export default function OverviewPage() {
  return (
    <>
      <header className="flex flex-col gap-3 border-b pb-7 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-primary mb-3 text-[11px] font-semibold tracking-[0.17em] uppercase">
            Credit operations / Daily position
          </p>
          <h1 className="text-foreground text-3xl font-semibold tracking-[-0.045em] md:text-4xl">
            The credit desk
          </h1>
          <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-relaxed">
            A working view of outstanding exposure, reviews and portfolio
            exceptions. Every decision begins with the underlying records.
          </p>
        </div>
        <div className="border-border bg-card self-start rounded-sm border px-4 py-2.5 md:self-auto">
          <p className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
            Business as of
          </p>
          <p className="num text-sm font-semibold">
            {businessDate(DEMO_TODAY)}
          </p>
        </div>
      </header>
      <Suspense fallback={<Loading label="Loading portfolio position..." />}>
        <WorkbenchData />
      </Suspense>
    </>
  );
}

async function WorkbenchData() {
  await connection();
  const [clients, batches, incidents, records] = await Promise.all([
    listClients(),
    listBatches(),
    incidentsAsOf(DEMO_TODAY),
    decisionRecords(),
  ]);

  const pending = batches.filter((batch) => batch.status === "PENDING");
  const open = incidents.filter((incident) => incident.status !== "RESOLVED");
  const high = open.filter((incident) => incident.severity === "HIGH");
  const exposureCents = clients.reduce(
    (sum, client) => sum + client.fundsInUseCents,
    0,
  );
  const committedCents = clients.reduce(
    (sum, client) => sum + client.facilityLimitCents,
    0,
  );
  const commitmentHeadroomCents = clients.reduce(
    (sum, client) =>
      sum + Math.max(0, client.facilityLimitCents - client.fundsInUseCents),
    0,
  );
  const priority = [...pending].sort(
    (a, b) =>
      b.highRisk - a.highRisk ||
      b.flagged - a.flagged ||
      b.submittedDate.localeCompare(a.submittedDate),
  );
  const rankedClients = [...clients].sort(
    (a, b) =>
      b.fundsInUseCents / Math.max(1, b.facilityLimitCents) -
      a.fundsInUseCents / Math.max(1, a.facilityLimitCents),
  );
  const liveAgreement = agreementReport(
    records.filter((record) => !record.simulated),
  );

  return (
    <div className="flex flex-col gap-9">
      <section aria-labelledby="position-heading">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2
            id="position-heading"
            className="text-sm font-semibold tracking-tight"
          >
            Portfolio position
          </h2>
          <span className="text-muted-foreground text-xs">
            NZD · Synthetic book
          </span>
        </div>
        <dl className="border-border bg-card grid overflow-hidden rounded-sm border sm:grid-cols-2 xl:grid-cols-4 xl:divide-x">
          <Metric
            label="Funds in use"
            value={money(exposureCents)}
            sublabel={`Across ${clients.length} client facilities`}
          />
          <Metric
            label="Commitment headroom"
            value={money(commitmentHeadroomCents)}
            sublabel="Not verified draw availability"
          />
          <Metric
            label="Awaiting review"
            value={String(pending.length)}
            sublabel="Funding batches"
            href="/batches"
          />
          <Metric
            label="Open risk incidents"
            value={String(open.length)}
            sublabel={`${high.length} high-severity incidents`}
            href="/watch"
            attention={high.length > 0}
          />
        </dl>
        <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
          The facility headroom shown here is the difference between
          commitments and amounts outstanding. It is not a borrowing-base
          calculation and must not be used to authorise funding.
        </p>
      </section>

      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
        <section aria-labelledby="review-heading" className="min-w-0">
          <SectionHeading
            id="review-heading"
            eyebrow="01 / Action"
            title="Review priorities"
            description="Batches ordered by high-risk findings, then other flags."
            href="/batches"
            action="All batches"
          />
          <div className="border-border bg-card overflow-hidden rounded-sm border">
            {priority.length === 0 ? (
              <EmptyState text="No submitted batches currently need review." />
            ) : (
              <ul className="divide-border divide-y">
                {priority.slice(0, 7).map((batch) => (
                  <li key={batch.id}>
                    <Link
                      href={`/batches/${batch.id}`}
                      className="hover:bg-accent/60 focus-visible:ring-ring group grid gap-2 px-4 py-4 focus-visible:ring-2 focus-visible:outline-none sm:grid-cols-[1fr_auto] sm:items-center sm:px-5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {batch.clientName}
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {businessDate(batch.submittedDate)} · {batch.invoiceCount} invoices
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        {batch.highRisk > 0 ? (
                          <Chip tone="high">{batch.highRisk} high risk</Chip>
                        ) : null}
                        {batch.flagged > 0 ? (
                          <Chip tone="flagged">{batch.flagged} flagged</Chip>
                        ) : null}
                        <span className="num min-w-24 text-right text-sm font-semibold">
                          {money(batch.faceCents)}
                        </span>
                        <span
                          aria-hidden="true"
                          className="text-muted-foreground group-hover:text-primary ml-1"
                        >
                          ↗
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section aria-labelledby="risk-heading" className="min-w-0">
          <SectionHeading
            id="risk-heading"
            eyebrow="02 / Monitoring"
            title="Risk watch"
            description="Outstanding exceptions across the funded book."
            href="/watch"
            action="Open monitor"
          />
          <div className="border-border bg-card overflow-hidden rounded-sm border">
            <div className="border-border flex items-baseline justify-between gap-4 border-b px-5 py-4">
              <span className="text-muted-foreground text-xs">
                High-severity events
              </span>
              <span className="num text-xl font-semibold">{high.length}</span>
            </div>
            {open.length === 0 ? (
              <EmptyState text="No open risk incidents for this business date." />
            ) : (
              <ul className="divide-border divide-y">
                {open
                  .slice()
                  .sort(
                    (a, b) =>
                      Number(b.severity === "HIGH") -
                        Number(a.severity === "HIGH") ||
                      b.firstDetectedDate.localeCompare(a.firstDetectedDate),
                  )
                  .slice(0, 5)
                  .map((incident) => (
                    <li key={incident.id}>
                      <Link
                        href={`/watch?asOf=${DEMO_TODAY}&incident=${encodeURIComponent(incident.id)}`}
                        className="hover:bg-accent/60 focus-visible:ring-ring flex items-start justify-between gap-3 px-5 py-3.5 focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {incident.clientName}
                          </p>
                          <p className="text-muted-foreground mt-1 text-xs">
                            {incident.ruleId.replaceAll("_", " ").toLowerCase()} ·{" "}
                            {businessDate(incident.firstDetectedDate)}
                          </p>
                        </div>
                        <Chip
                          tone={
                            incident.severity === "HIGH"
                              ? "high"
                              : incident.severity === "MEDIUM"
                                ? "flagged"
                                : "info"
                          }
                        >
                          {incident.severity.toLowerCase()}
                        </Chip>
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <section aria-labelledby="facility-heading">
        <SectionHeading
          id="facility-heading"
          eyebrow="03 / Exposure"
          title="Facility utilisation"
          description={`Current exposure against ${money(committedCents)} in total commitments.`}
        />
        <div className="border-border bg-card overflow-hidden rounded-sm border">
          <div className="border-border text-muted-foreground hidden grid-cols-[minmax(0,1.5fr)_1fr_1fr_1fr] gap-4 border-b px-5 py-3 text-[11px] font-semibold tracking-wide uppercase md:grid">
            <span>Client</span>
            <span className="text-right">Utilised</span>
            <span className="text-right">Facility</span>
            <span className="text-right">Utilisation</span>
          </div>
          {rankedClients.length === 0 ? (
            <EmptyState text="No synthetic facilities are in the book." />
          ) : (
            <ul className="divide-border divide-y">
              {rankedClients.map((client) => {
                const usage =
                  client.facilityLimitCents > 0
                    ? client.fundsInUseCents / client.facilityLimitCents
                    : 0;
                const displayUsage = Math.round(usage * 100);
                return (
                  <li
                    key={client.id}
                    className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1.5fr)_1fr_1fr_1fr] md:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {client.name}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-xs capitalize">
                        {client.industry}
                      </p>
                    </div>
                    <div className="num text-sm md:text-right">
                      {money(client.fundsInUseCents)}
                    </div>
                    <div className="num text-muted-foreground text-sm md:text-right">
                      {money(client.facilityLimitCents)}
                    </div>
                    <div>
                      <div className="num mb-1.5 text-right text-xs font-semibold">
                        {displayUsage}%
                      </div>
                      <div
                        role="img"
                        aria-label={`${client.name}: ${displayUsage}% of facility used`}
                        className="bg-muted h-1.5 overflow-hidden rounded-full"
                      >
                        <div
                          className={
                            usage >= 0.9
                              ? "bg-destructive h-full"
                              : "bg-primary h-full"
                          }
                          style={{
                            width: `${Math.min(100, Math.max(0, usage * 100))}%`,
                          }}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section
        aria-label="Model assurance and source freshness"
        className="border-border grid gap-4 border-t pt-5 text-sm md:grid-cols-2"
      >
        <div>
          <p className="font-semibold">Decision assurance</p>
          <p className="text-muted-foreground mt-1 leading-relaxed">
            {liveAgreement.overall.n === 0
              ? "No eligible live shadow decisions yet."
              : `Agent and analyst agreement: ${percent(liveAgreement.overall.rate)} across ${liveAgreement.overall.n} eligible shadow decisions.`}{" "}
            <Link
              href="/trust"
              className="text-primary underline-offset-4 hover:underline"
            >
              Review evaluation and replay →
            </Link>
          </p>
        </div>
        <div>
          <p className="font-semibold">Data provenance</p>
          <p className="text-muted-foreground mt-1 leading-relaxed">
            This environment uses deterministic synthetic data. No live
            accounting or bank feed is connected; real-time source freshness
            cannot be claimed.
          </p>
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  sublabel,
  href,
  attention = false,
}: {
  label: string;
  value: string;
  sublabel: string;
  href?: string;
  attention?: boolean;
}) {
  return (
    <div className="border-border border-b px-5 py-5 last:border-b-0 sm:nth-[2]:border-b-0 xl:border-b-0">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="mt-3">
        {href ? (
          <Link
            href={href}
            className={`num focus-visible:ring-ring text-2xl font-semibold tracking-tight underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none ${attention ? "text-destructive" : ""}`}
          >
            {value}
          </Link>
        ) : (
          <span className="num text-2xl font-semibold tracking-tight">
            {value}
          </span>
        )}
      </dd>
      <p className="text-muted-foreground mt-2 text-xs">{sublabel}</p>
    </div>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  href,
  action,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-primary mb-1 text-[10px] font-semibold tracking-[0.16em] uppercase">
          {eyebrow}
        </p>
        <h2 id={id} className="text-lg font-semibold tracking-[-0.025em]">
          {title}
        </h2>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          {description}
        </p>
      </div>
      {href && action ? (
        <Link
          href={href}
          className="text-primary focus-visible:ring-ring text-xs font-semibold underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          {action} →
        </Link>
      ) : null}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="text-muted-foreground px-5 py-10 text-center text-sm">
      {text}
    </p>
  );
}
