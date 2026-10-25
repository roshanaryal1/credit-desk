import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Loading, PageHeader } from "@/components/page";
import { getDb } from "@/lib/db/client";
import { DEMO_TODAY } from "@/lib/demo";
import { businessDate } from "@/lib/format";
import { getWatchTrends } from "@/lib/queries/watch-trends";

export const metadata = { title: "Portfolio risk trends · Credit Desk" };

export default function RiskTrendsPage() {
  return (
    <Suspense
      fallback={<Loading label="Calculating synthetic watch trends..." />}
    >
      <TrendView />
    </Suspense>
  );
}

async function TrendView() {
  await connection();
  const trends = await getWatchTrends(await getDb(), DEMO_TODAY);
  return (
    <>
      <Link
        href="/watch"
        className="text-primary text-sm underline-offset-4 hover:underline"
      >
        ← Portfolio Watch
      </Link>
      <PageHeader
        title="Risk incident trends"
        description={
          "Descriptive synthetic detection counts · as of " +
          businessDate(trends.asOf)
        }
      />
      <div className="border-border bg-card rounded-sm border p-5">
        <p className="text-sm font-semibold">What these figures mean</p>
        <p className="text-muted-foreground mt-2 text-sm">
          These are actual recorded synthetic incident detections and dated
          status events from the demo ledger. No uncalibrated risk forecast,
          alert delivery, policy SLA or live-provider source freshness is
          implied. Latest actions after the selected business date are excluded.
        </p>
      </div>
      <dl className="border-border bg-card grid rounded-sm border sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Incidents detected", value: String(trends.incidentsTotal) },
          { label: "Unresolved as of date", value: String(trends.unresolved) },
          {
            label: "Unresolved high severity",
            value: String(trends.highUnresolved),
          },
          { label: "New, last 30 days", value: String(trends.detectedLast30) },
        ].map((m) => (
          <div key={m.label} className="border-border border-b p-5 sm:border-r">
            <dt className="text-muted-foreground text-xs">{m.label}</dt>
            <dd className="num mt-2 text-2xl font-semibold">{m.value}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-6 lg:grid-cols-2">
        <section
          aria-labelledby="trend-history-title"
          className="border-border bg-card rounded-sm border p-5"
        >
          <h2 id="trend-history-title" className="font-semibold">
            New detections by business day
          </h2>
          <p className="text-muted-foreground mt-1 text-xs">
            Most recent fourteen synthetic business dates, including zero-count
            days.
          </p>
          <table className="mt-4 w-full text-sm">
            <caption className="sr-only">
              Last fourteen days of incident detections
            </caption>
            <thead className="text-muted-foreground border-b text-xs">
              <tr>
                <th scope="col" className="py-2 text-left">
                  NZ date
                </th>
                <th scope="col" className="py-2 text-right">
                  Detected
                </th>
                <th scope="col" className="py-2 text-right">
                  High
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {trends.timeline.map((day) => (
                <tr key={day.date}>
                  <td className="py-2">
                    <Link
                      href={"/watch?asOf=" + day.date}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {businessDate(day.date)}
                    </Link>
                  </td>
                  <td className="num py-2 text-right">{day.count}</td>
                  <td className="num py-2 text-right">{day.high}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section
          aria-labelledby="trend-resolution-title"
          className="border-border bg-card rounded-sm border p-5"
        >
          <h2 id="trend-resolution-title" className="font-semibold">
            Resolution and movement
          </h2>
          <dl className="mt-4 space-y-4 text-sm">
            <div>
              <dt className="text-muted-foreground text-xs">
                Detected in prior 30-day window
              </dt>
              <dd className="num mt-1 font-semibold">
                {trends.detectedPrior30}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">
                Resolved as of date
              </dt>
              <dd className="num mt-1 font-semibold">{trends.resolved}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">
                Mean days to resolution (currently resolved incidents)
              </dt>
              <dd className="num mt-1 font-semibold">
                {trends.meanDaysToResolution === null
                  ? "Insufficient observations"
                  : trends.meanDaysToResolution.toFixed(1) + " days"}
                <span className="text-muted-foreground mt-1 block text-xs font-normal">
                  {trends.meanResolutionSample} qualifying resolved incidents.
                  Reopened incidents are not considered finally resolved.
                </span>
              </dd>
            </div>
          </dl>
          <Link
            className="text-primary mt-6 inline-block text-sm underline-offset-4 hover:underline"
            href="/watch"
          >
            Examine individual incident evidence →
          </Link>
        </section>
      </div>
    </>
  );
}
