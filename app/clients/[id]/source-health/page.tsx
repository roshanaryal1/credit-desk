import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { Loading, PageHeader } from "@/components/page";
import { getDb } from "@/lib/db/client";
import { DEMO_TODAY } from "@/lib/demo";
import { businessDate, money } from "@/lib/format";
import { clientSourceReconciliation } from "@/lib/queries/client-source-reconciliation";

export const metadata = { title: "Source reconciliation · Credit Desk" };

export default function ClientSourceHealthPage({
  params,
}: PageProps<"/clients/[id]/source-health">) {
  return (
    <Suspense
      fallback={<Loading label="Checking synthetic source evidence..." />}
    >
      <SourceView params={params} />
    </Suspense>
  );
}

async function SourceView({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  // Injected demo cutoff rather than wall-clock time; no future journal
  // observations or checkpoints may leak into a historical view.
  const cutoff = new Date(DEMO_TODAY + "T23:59:59.999Z");
  const data = await clientSourceReconciliation(
    await getDb(),
    id,
    DEMO_TODAY,
    cutoff,
  );
  if (!data) notFound();
  return (
    <div className="space-y-7">
      <Link
        href={`/clients/${encodeURIComponent(id)}`}
        className="text-primary text-sm underline underline-offset-4"
      >
        ← Client 360
      </Link>
      <PageHeader
        title="Accounting and bank source health"
        description={`${data.client.name} · synthetic business date ${businessDate(data.asOf)}`}
      />
      <div
        role="note"
        className="border-status-flagged bg-status-flagged-bg rounded-sm border p-5"
      >
        <p className="text-status-flagged text-sm font-semibold">
          Synthetic source reconciliation — not verified live cash or drawable
          funding
        </p>
        <p className="text-muted-foreground mt-2 text-sm">
          Journal checkpoints describe fictional ingestion health. The legacy
          demo ledger/bank tables lack complete observed-at history and cannot
          establish real provider verification or borrower balances. UNKNOWN is
          not zero, and a fresh synthetic checkpoint is not bank authentication.
        </p>
      </div>
      <section aria-labelledby="source-panel-title">
        <h2 id="source-panel-title" className="mb-3 text-base font-semibold">
          Source checkpoint status
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {data.sourceHealth.map((source) => (
            <article
              key={source.id}
              className="border-border bg-card rounded-sm border p-4 text-sm"
            >
              <h3 className="font-semibold">{source.kind}</h3>
              <p className="text-muted-foreground mt-1">
                Connection: {source.connectionId}
              </p>
              <p className="mt-2 font-semibold">Status: {source.health}</p>
              <p className="text-muted-foreground mt-2 text-xs">
                Successful checkpoint: {source.lastSuccess ?? "UNKNOWN"}
              </p>
              <p className="text-muted-foreground text-xs">
                Latest failure: {source.lastFailure ?? "none recorded"}
              </p>
              <p className="text-muted-foreground text-xs">
                Accepted dated journal observations: {source.acceptedEvents}
              </p>
            </article>
          ))}
        </div>
        <p className="text-muted-foreground mt-2 text-xs">
          UTC knowledge cutoff: {data.knowledgeCutoff} · freshness tolerance:{" "}
          {data.thresholdMinutes} minutes · no provider connection is verified.
        </p>
      </section>
      <section aria-labelledby="cash-reconciliation-title">
        <h2
          id="cash-reconciliation-title"
          className="mb-3 text-base font-semibold"
        >
          Allocated and unmatched synthetic cash
        </h2>
        <dl className="border-border bg-card grid rounded-sm border sm:grid-cols-3">
          {[
            ["Bank receipt total", data.bankTotalCents],
            ["Linked ledger allocation", data.allocatedCents],
            ["Unallocated bank receipt", data.unmatchedCents],
          ].map(([label, cents]) => (
            <div
              className="border-border border-b p-4 sm:border-r sm:border-b-0"
              key={label}
            >
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="num mt-2 text-lg font-semibold">
                {money(cents as number)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground mt-2 text-xs">
          {data.matchedCount} matched · {data.partialCount} partial ·{" "}
          {data.unmatchedCount} unmatched bank records. Each bank transaction is
          counted once. Credit notes are separate accounting adjustments:{" "}
          {money(data.creditNoteCents)}.
        </p>
        <div
          role="region"
          aria-label="Synthetic bank matching evidence"
          tabIndex={0}
          className="border-border bg-card focus-visible:ring-ring mt-4 overflow-x-auto rounded-sm border focus-visible:ring-2"
        >
          <table className="w-full min-w-[680px] text-sm">
            <thead className="text-muted-foreground border-b text-left">
              <tr>
                <th scope="col" className="p-3">
                  Bank source
                </th>
                <th scope="col" className="p-3">
                  State / linked ledger IDs
                </th>
                <th scope="col" className="p-3 text-right">
                  Receipt
                </th>
                <th scope="col" className="p-3 text-right">
                  Allocated
                </th>
                <th scope="col" className="p-3 text-right">
                  Unmatched
                </th>
              </tr>
            </thead>
            <tbody>
              {data.bankTransactions.map((row) => (
                <tr className="border-t" key={row.id}>
                  <th scope="row" className="p-3 text-left">
                    {row.id}
                    <span className="text-muted-foreground block text-xs">
                      {businessDate(row.date)}
                    </span>
                  </th>
                  <td className="p-3">
                    {row.state}
                    <span className="text-muted-foreground block text-xs break-all">
                      {row.allocations
                        .map(
                          (a) => `${a.ledgerId} (${money(a.allocatedCents)})`,
                        )
                        .join(", ") || "No dated allocation"}
                    </span>
                  </td>
                  <td className="num p-3 text-right">
                    {money(row.amountCents)}
                  </td>
                  <td className="num p-3 text-right">
                    {money(row.allocatedCents)}
                  </td>
                  <td className="num p-3 text-right">
                    {money(row.unmatchedCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.bankTransactions.length && (
            <p className="text-muted-foreground p-5 text-sm">
              No synthetic bank transactions are recorded for this date.
              Provider completeness remains UNKNOWN, not a verified zero.
            </p>
          )}
        </div>
        {data.creditNoteIds.length > 0 && (
          <p className="text-muted-foreground mt-2 text-xs break-all">
            Dated credit note sources: {data.creditNoteIds.join(", ")}
          </p>
        )}
      </section>
      <p className="text-muted-foreground border-t pt-3 text-xs">
        Read-only demonstration. No banking credentials, live source calls,
        notification, approved credit policy or disbursement execution.
      </p>
    </div>
  );
}
