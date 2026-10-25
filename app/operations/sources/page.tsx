import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Loading, PageHeader } from "@/components/page";
import { readSyntheticSyncOperations } from "@/lib/data/sync-operations";
import { getDb } from "@/lib/db/client";
import { DEMO_TODAY } from "@/lib/demo";

export const metadata = { title: "Synthetic source operations" };

export default function SyntheticSourceOperations() {
  return (
    <Suspense fallback={<Loading label="Reading source job states..." />}>
      <Sources />
    </Suspense>
  );
}

async function Sources() {
  await connection();
  const observedAt = new Date(DEMO_TODAY + "T12:00:00Z");
  const report = await readSyntheticSyncOperations(await getDb(), observedAt);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Synthetic ingestion operations"
        description="Read-only source job queue, checkpoint freshness and actionable exceptions"
      />
      <section className="border-border bg-card rounded-sm border p-5">
        <h2 className="font-semibold">Demonstration control plane only</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          The dashboard inspects fictional checkpoints and jobs at a fixed
          simulation instant. Job rows are mutable operational state, not
          historical replay. No Xero or Akahu consented connection, verified
          customer account or live ingestion worker is claimed. No retry, lease,
          data access or provider action can be triggered here.
        </p>
        <p className="text-muted-foreground mt-2 text-xs">
          Simulation reference (UTC): {report.observedAt}
        </p>
      </section>
      <section aria-label="Sync health metrics">
        <dl className="border-border bg-card grid rounded-sm border sm:grid-cols-3">
          {[
            [
              "Configured source jobs and checkpoints",
              report.counts.connections,
            ],
            ["Dead-lettered jobs", report.counts.deadLetters],
            ["Expired leases", report.counts.expiredLeases],
            ["Due retries", report.counts.dueRetries],
            ["Sources reporting failure", report.counts.sourceErrors],
            ["Sources with unknown freshness", report.counts.unknownSources],
          ].map(([label, value]) => (
            <div key={label} className="border-border border-b p-4 sm:border-r">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="num mt-2 text-2xl font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="sources-heading">
        <h2 id="sources-heading" className="mb-3 font-semibold">
          Source jobs and exceptions
        </h2>
        <div
          role="region"
          aria-label="Synthetic ingestion source statuses"
          tabIndex={0}
          className="border-border bg-card focus-visible:ring-ring overflow-x-auto rounded-sm border focus-visible:ring-2"
        >
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-border text-muted-foreground border-b text-left">
              <tr>
                <th className="p-3" scope="col">
                  Fictional client and source
                </th>
                <th className="p-3" scope="col">
                  Job
                </th>
                <th className="p-3" scope="col">
                  Freshness
                </th>
                <th className="p-3" scope="col">
                  Exception
                </th>
                <th className="p-3" scope="col">
                  Last success / retry
                </th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.key} className="border-border border-b align-top">
                  <th scope="row" className="p-3 text-left font-medium">
                    {row.clientName}
                    <span className="text-muted-foreground block text-xs break-all">
                      {row.clientId} · {row.sourceKind} · {row.connectionId}
                    </span>
                  </th>
                  <td className="p-3">
                    {row.condition}
                    <span className="text-muted-foreground block text-xs">
                      Attempts {row.attempts}/{row.maxAttempts ?? "unknown"}
                    </span>
                  </td>
                  <td className="p-3">{row.freshness}</td>
                  <td className="p-3">
                    {row.exception ?? "None"}
                    {row.lastSafeError && (
                      <span className="text-muted-foreground block text-xs">
                        Safe code: {row.lastSafeError}
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-xs">
                    <span className="block">
                      {row.lastSuccessAt ?? "UNKNOWN"}
                    </span>
                    <span className="text-muted-foreground block">
                      Retry: {row.nextAttemptAt ?? "not scheduled"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.rows.length === 0 && (
            <p className="text-muted-foreground p-5 text-sm" role="status">
              No synthetic source sync jobs or checkpoints are registered. This
              means source completeness is UNKNOWN, not healthy or empty.
            </p>
          )}
        </div>
      </section>
      <p className="text-muted-foreground text-xs">
        Source errors are allowlisted codes; original provider error text and
        credentials are not exposed. Refer to{" "}
        <Link
          href="/clients"
          className="text-primary underline underline-offset-4"
        >
          Client 360
        </Link>{" "}
        for dated synthetic balances. Real sync monitoring and alerting remain
        gated by identity, provider consent and runtime deployment.
      </p>
    </div>
  );
}
