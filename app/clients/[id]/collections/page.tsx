import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { Loading, PageHeader } from "@/components/page";
import { DEMO_TODAY } from "@/lib/demo";
import { getDb } from "@/lib/db/client";
import { businessDate, money } from "@/lib/format";
import { getClientDossier } from "@/lib/queries/client-360";
import { getClientReceivablesAgeing } from "@/lib/queries/client-ageing";
import { collectionsRiskSummary } from "@/lib/risk/client-collections-pulse";

export const metadata = { title: "Collections insights · Credit Desk" };

export default function ClientCollectionsPage({
  params,
}: PageProps<"/clients/[id]/collections">) {
  return (
    <Suspense fallback={<Loading label="Loading collections evidence..." />}>
      <CollectionsView params={params} />
    </Suspense>
  );
}

async function CollectionsView({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  const db = await getDb();
  const [dossier, ageing] = await Promise.all([
    getClientDossier(db, id, DEMO_TODAY),
    getClientReceivablesAgeing(db, id, DEMO_TODAY),
  ]);
  if (!dossier || !ageing) notFound();
  const pulse = collectionsRiskSummary(ageing);
  const rows = [...ageing.collections].sort(
    (a, b) =>
      b.overdueNowCents - a.overdueNowCents ||
      a.debtorName.localeCompare(b.debtorName),
  );

  return (
    <>
      <Link
        href={"/clients/" + encodeURIComponent(id)}
        className="text-primary text-sm underline-offset-4 hover:underline"
      >
        ← Relationship dossier
      </Link>
      <PageHeader
        title="Collections insights"
        description={
          dossier.client.name +
          " · synthetic ledger / business as of " +
          businessDate(ageing.asOf)
        }
      />
      <div className="border-border bg-card rounded-sm border p-5">
        <h2 className="text-sm font-semibold">
          Data confidence and interpretation
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          This view only describes dated synthetic receipts, credit notes and
          receivables from this client. DSO is not available: the prototype has
          not verified complete credit-sales and opening receivables history.
          Settlement-day averages use only fully cash-paid invoices with no
          credits. No number or flag authorises funding.
        </p>
      </div>
      <section aria-labelledby="collections-pulse-heading">
        <h2 id="collections-pulse-heading" className="mb-3 text-base font-semibold">
          Reconciled client collections pulse
        </h2>
        <p className="text-muted-foreground mb-4 text-xs">
          Deterministic synthetic ledger measures, not a credit score,
          approved borrowing availability, or verified real-world DSO.
        </p>
        {pulse.status === "INSUFFICIENT_SOURCE_RECORDS" ? (
          <p className="border-border bg-card rounded-sm border p-5 text-sm" role="status">
            No dated ledger evidence exists for a portfolio pulse. Monetary
            movements and concentration are UNKNOWN rather than verified zero.
          </p>
        ) : (
          <>
            <dl className="border-border bg-card grid rounded-sm border sm:grid-cols-3">
              {[
                ["Overdue receivables", pulse.overdueNowCents],
                ["Overdue 30 days previously", pulse.overduePrevious30DaysCents],
                ["Arrears change over 30 days", pulse.overdueMovementCents],
                ["Receipts in last 30 days", pulse.receiptsLast30DaysCents],
                ["Receipts in preceding 30 days", pulse.receiptsPrevious30DaysCents],
                ["Credit notes in last 30 days", pulse.creditsLast30DaysCents],
              ].map(([label, value]) => (
                <div className="border-border border-b p-4 sm:border-r" key={label}>
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd className="num mt-2 text-lg font-semibold">
                    {value === null ? "UNKNOWN" : money(value as number)}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="border-border bg-card mt-4 rounded-sm border p-5">
              <h3 className="text-sm font-semibold">Largest synthetic debtor exposure</h3>
              <p className="mt-2 text-sm">
                {pulse.largestDebtor?.name ?? "Insufficient evidence"}
                {" · "}{pulse.largestDebtor
                  ? money(pulse.largestDebtor.outstandingCents)
                  : "UNKNOWN"}
                {" · "}{pulse.largestDebtor?.shareBps === null
                  ? "share not measurable"
                  : ((pulse.largestDebtor?.shareBps ?? 0) / 100).toFixed(2) +
                    "% of dated receivables"}
              </p>
              <p className="text-muted-foreground mt-2 break-all text-xs">
                Contributing ledger IDs:
                {" "}{pulse.largestDebtor?.ledgerInvoiceIds.join(", ") || "none"}
              </p>
              <p className="text-muted-foreground mt-2 text-xs">
                {pulse.observations.length} evidence-linked descriptive
                observation(s). Expand individual debtors below for dated
                invoices, receipts and credit-note source IDs. No new model
                prediction or lending decision is generated.
              </p>
            </div>
          </>
        )}
      </section>
      <section aria-labelledby="collections-table-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              id="collections-table-title"
              className="text-base font-semibold"
            >
              Debtor-level collections
            </h2>
            <p className="text-muted-foreground mt-1 text-xs">
              Most recent 30 calendar days versus the preceding 30 days.
              Monetary amounts are NZD.
            </p>
          </div>
          <p className="text-muted-foreground text-xs">
            {rows.length} debtors with dated ledger records
          </p>
        </div>
        <div
          role="region"
          aria-labelledby="collections-table-title"
          tabIndex={0}
          className="border-border bg-card focus-visible:ring-ring overflow-x-auto rounded-sm border focus-visible:ring-2 focus-visible:outline-none"
        >
          <table className="w-full min-w-[900px] text-sm">
            <caption className="sr-only">
              As-of collections, overdue movement, credits and settlement timing
              by synthetic debtor
            </caption>
            <thead className="text-muted-foreground border-b text-xs">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium">
                  Debtor and evidence
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  Past due
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  30-day movement
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  Receipts (30d)
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  Previous 30d
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  Credits (30d)
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  Cash-settled days
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  DSO
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {rows.map((row) => (
                <tr key={row.debtorId}>
                  <th scope="row" className="px-4 py-4 text-left align-top">
                    <span className="font-semibold">{row.debtorName}</span>
                    <p className="text-muted-foreground mt-1 text-xs font-normal">
                      {row.signals.length} descriptive observations
                    </p>
                    {row.signals.length > 0 && (
                      <details className="mt-2 text-xs font-normal">
                        <summary className="text-primary cursor-pointer font-semibold underline-offset-4 hover:underline">
                          View rule evidence
                        </summary>
                        <ul className="mt-2 space-y-3">
                          {row.signals.map((signal) => (
                            <li
                              key={signal.code}
                              className="text-muted-foreground"
                            >
                              <strong className="text-foreground block">
                                {signal.code.replaceAll("_", " ")}
                              </strong>
                              {signal.description}
                              <span className="mt-1 block break-all">
                                Ledger invoices:{" "}
                                {signal.invoiceIds.join(", ") || "none"}
                              </span>
                              <span className="block break-all">
                                Receipt / credit sources:{" "}
                                {signal.sourceIds.join(", ") ||
                                  "ledger balances"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </th>
                  <td className="num px-3 py-4 text-right align-top">
                    {money(row.overdueNowCents)}
                  </td>
                  <td className="num px-3 py-4 text-right align-top">
                    {row.overdueMovement30DaysCents > 0 ? "+" : ""}
                    {money(row.overdueMovement30DaysCents)}
                  </td>
                  <td className="num px-3 py-4 text-right align-top">
                    {money(row.receiptsLast30DaysCents)}
                  </td>
                  <td className="num px-3 py-4 text-right align-top">
                    {money(row.receiptsPrevious30DaysCents)}
                  </td>
                  <td className="num px-3 py-4 text-right align-top">
                    {money(row.creditsLast30DaysCents)}
                  </td>
                  <td className="num px-3 py-4 text-right align-top">
                    {row.meanDaysToCashSettlement === null
                      ? "Insufficient sample"
                      : row.meanDaysToCashSettlement.toFixed(1) +
                        " days (" +
                        row.cashSettledInvoiceCount +
                        ")"}
                  </td>
                  <td className="px-3 py-4 text-right align-top">
                    Not verified
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="text-muted-foreground p-6 text-sm">
              No dated synthetic receivables available. This does not mean a
              verified real-world zero balance.
            </p>
          )}
        </div>
      </section>
      <p className="text-muted-foreground border-t pt-3 text-xs">
        Synthetic demonstration only. Historical facility terms, source
        completeness, accounting-approved DSO, altered due dates, write-offs and
        authoritative client identity are outside this preview. The linked
        invoice/source IDs are synthetic provenance, not provider verification.
      </p>
    </>
  );
}
