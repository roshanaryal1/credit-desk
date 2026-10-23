import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Chip, DecisionChip } from "@/components/chips";
import { Loading, PageHeader, Section } from "@/components/page";
import { TrustTabs } from "@/components/trust-tabs";
import { WeeklyChart } from "@/components/weekly-chart";
import { checkLabel } from "@/lib/checks/labels";
import { percent } from "@/lib/format";
import { decisionRecords } from "@/lib/queries/trust";
import {
  EXCLUSION_LABELS,
  agreementReport,
  checkSummaryLine,
  type ExclusionReason,
  type Rate,
} from "@/lib/trust/agreement";
import { cn } from "@/lib/utils";

export const metadata = { title: "Trust Panel" };

// Below this many decisions a per-check rate is not shown (SPEC 9.2).
const MIN_N = 10;

export default function TrustPage({ searchParams }: PageProps<"/trust">) {
  return (
    <>
      <PageHeader
        title="Trust Panel"
        description="How often the agent agrees with analysts who decided without seeing it. A measurement for people to discuss, not a switch to automate."
      />
      <TrustTabs current="/trust" />
      <Suspense fallback={<Loading label="Calculating agreement..." />}>
        <Agreement searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const COHORTS = [
  { key: "live", label: "Live decisions" },
  { key: "simulated", label: "Simulated history" },
  { key: "all", label: "Both" },
] as const;

const rateText = (r: Rate) =>
  r.rate === null
    ? "n/a"
    : `${percent(r.rate)} (${r.agree} of ${r.n}; 95% CI ${percent(r.low)} to ${percent(r.high)})`;

async function Agreement({
  searchParams,
}: {
  searchParams: PageProps<"/trust">["searchParams"];
}) {
  await connection();
  const sp = await searchParams;
  const cohort = COHORTS.find((c) => c.key === sp.cohort)?.key ?? "live";
  const all = await decisionRecords();
  const pick = (k: string) =>
    all.filter((r) =>
      k === "all" ? true : k === "simulated" ? r.simulated : !r.simulated,
    );
  const live = agreementReport(pick("live"));
  const simulated = agreementReport(pick("simulated"));
  const report =
    cohort === "live"
      ? live
      : cohort === "simulated"
        ? simulated
        : agreementReport(all);

  return (
    <>
      <dl className="grid gap-4 sm:grid-cols-2">
        <CohortFigure label="Live decisions" report={live} />
        <CohortFigure label="Simulated history" report={simulated} simulated />
      </dl>

      <nav aria-label="Cohort" className="flex flex-wrap gap-2">
        {COHORTS.map((c) => (
          <Link
            key={c.key}
            href={`/trust?cohort=${c.key}`}
            aria-current={c.key === cohort ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none",
              c.key === cohort
                ? "border-primary bg-accent font-medium"
                : "hover:bg-accent/60",
            )}
          >
            {c.label}
          </Link>
        ))}
      </nav>

      {cohort !== "live" ? (
        <p className="bg-status-flagged-bg text-status-flagged rounded-md px-3 py-2 text-sm">
          Simulated decisions were generated from the evaluation labels to give
          this view a history. They show how the panel works, not how good the
          agent is.
        </p>
      ) : null}

      {report.eligible === 0 ? (
        <p className="text-muted-foreground text-sm">
          No eligible decisions in this cohort yet. Make a decision in shadow
          mode on a flagged invoice and it appears here.
        </p>
      ) : (
        <>
          <Section
            title="By check"
            description="An invoice counts toward every check that fired on it, so these groups overlap."
          >
            <ul className="bg-card divide-y rounded-md border text-sm">
              {Object.entries(report.byCheck).map(([check, rate]) => (
                <li key={check} className="px-4 py-2.5">
                  {checkSummaryLine(
                    checkLabel(check),
                    rate,
                    cohort === "simulated" ? 1 : MIN_N,
                  )}
                </li>
              ))}
            </ul>
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section
              title="Agent suggestion against analyst decision"
              description="Rows are what the agent suggested; columns are what the analyst decided."
            >
              <table className="bg-card w-full rounded-md border text-sm">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Agent
                    </th>
                    {(["APPROVE", "HOLD", "REJECT"] as const).map((d) => (
                      <th
                        key={d}
                        scope="col"
                        className="px-3 py-2 text-right font-medium"
                      >
                        <DecisionChip decision={d} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(["APPROVE", "HOLD", "REJECT", "REQUEST_INFO"] as const).map(
                    (rec) => (
                      <tr key={rec}>
                        <th
                          scope="row"
                          className="px-3 py-2 text-left font-normal"
                        >
                          <DecisionChip decision={rec} />
                        </th>
                        {(["APPROVE", "HOLD", "REJECT"] as const).map((d) => {
                          const agree =
                            (rec === "REQUEST_INFO" ? "HOLD" : rec) === d;
                          return (
                            <td
                              key={d}
                              className={cn(
                                "num px-3 py-2 text-right",
                                agree && "font-semibold",
                              )}
                            >
                              {report.confusion[rec][d]}
                            </td>
                          );
                        })}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
              <p className="text-muted-foreground text-xs">
                Request info counts as a hold when measuring agreement. Bold
                cells agree.
              </p>
            </Section>

            <Section title="By risk level">
              <ul className="bg-card divide-y rounded-md border text-sm">
                {Object.entries(report.byRisk).map(([risk, rate]) => (
                  <li
                    key={risk}
                    className="flex justify-between gap-3 px-4 py-2.5"
                  >
                    <span className="capitalize">
                      {risk.toLowerCase()} risk
                    </span>
                    <span className="num text-muted-foreground">
                      {rateText(rate)}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>

          {report.weekly.length > 1 ? (
            <Section title="Over time">
              <WeeklyChart
                data={report.weekly.map((w) => ({
                  week: w.week,
                  rate: w.rate.rate,
                  n: w.rate.n,
                }))}
              />
            </Section>
          ) : null}

          <Section
            title="Disagreements"
            description="Newest first. Open one to see exactly what the analyst saw."
          >
            {report.disagreements.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                None in this cohort.
              </p>
            ) : (
              <ul className="bg-card divide-y rounded-md border text-sm">
                {report.disagreements.slice(0, 25).map((d) => (
                  <li
                    key={d.decisionId}
                    className="flex flex-wrap items-center gap-2 px-4 py-2.5"
                  >
                    <Link
                      href={`/trust/replay/${d.decisionId}`}
                      className="text-primary font-medium underline underline-offset-4"
                    >
                      {d.invoiceId}
                    </Link>
                    <span className="text-muted-foreground">agent</span>{" "}
                    <DecisionChip decision={d.recommendation!} />
                    <span className="text-muted-foreground">analyst</span>{" "}
                    <DecisionChip decision={d.decision} />
                    {d.simulated ? <Chip tone="neutral">Simulated</Chip> : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </>
  );
}

function CohortFigure({
  label,
  report,
  simulated,
}: {
  label: string;
  report: ReturnType<typeof agreementReport>;
  simulated?: boolean;
}) {
  const excluded = Object.entries(report.excluded).filter(([, n]) => n > 0);
  return (
    <div className="bg-card rounded-md border p-4">
      <dt className="text-muted-foreground flex items-center gap-2 text-sm">
        {label} {simulated ? <Chip tone="neutral">Simulated</Chip> : null}
      </dt>
      <dd className="mt-1">
        <span className="num text-2xl font-semibold">
          {report.overall.rate === null ? "n/a" : percent(report.overall.rate)}
        </span>
        <span className="text-muted-foreground mt-1 block text-sm">
          {report.overall.n === 0
            ? "No eligible decisions yet."
            : `${report.overall.agree} of ${report.overall.n} agreed; 95% CI ${percent(report.overall.low)} to ${percent(report.overall.high)}; kappa ${report.kappa === null ? "n/a" : report.kappa.toFixed(2)}`}
        </span>
        {excluded.length > 0 ? (
          <span className="text-muted-foreground mt-1 block text-xs">
            Excluded:{" "}
            {excluded
              .map(([k, n]) => `${n} ${EXCLUSION_LABELS[k as ExclusionReason]}`)
              .join("; ")}
            .
          </span>
        ) : null}
      </dd>
    </div>
  );
}
