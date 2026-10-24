import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { PageHeader, Loading } from "@/components/page";
import { DEMO_TODAY } from "@/lib/demo";
import { businessDate, money, bpsToPercent } from "@/lib/format";
import { getDb } from "@/lib/db/client";
import { getClientDossier } from "@/lib/queries/client-360";
import { getClientReceivablesAgeing } from "@/lib/queries/client-ageing";

export default function ClientPage({ params }: PageProps<"/clients/[id]">) {
  return (
    <Suspense fallback={<Loading label="Loading relationship dossier..." />}>
      <ClientView params={params} />
    </Suspense>
  );
}

async function ClientView({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const db = await getDb();
  const [dossier, ageing] = await Promise.all([
    getClientDossier(db, id, DEMO_TODAY),
    getClientReceivablesAgeing(db, id, DEMO_TODAY),
  ]);
  if (!dossier || !ageing) notFound();
  const { client, batches, debtors, incidents } = dossier;
  return (
    <>
      <div>
        <Link
          href="/clients"
          className="text-primary text-sm underline-offset-4 hover:underline"
        >
          ← Client directory
        </Link>
      </div>
      <PageHeader
        title={client.name}
        description={`Relationship dossier · ${client.industry} · synthetic position as of ${businessDate(dossier.asOf)}`}
      />
      <section aria-label="Facility position">
        <h2 className="mb-3 text-base font-semibold">Facility position</h2>
        <dl className="border-border bg-card grid rounded-sm border sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "Facility commitment",
              value: money(client.facilityLimitCents),
            },
            { label: "Funded exposure", value: money(dossier.inUseCents) },
            {
              label: "Commitment headroom",
              value: money(dossier.commitmentHeadroomCents),
            },
            {
              label: "Contract advance rate",
              value: bpsToPercent(client.advanceRateBps),
            },
          ].map((item) => (
            <div
              className="border-border border-b px-5 py-4 sm:border-r"
              key={item.label}
            >
              <dt className="text-muted-foreground text-xs">{item.label}</dt>
              <dd className="num mt-2 text-xl font-semibold">{item.value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground mt-2 text-xs">
          Commitment headroom is not verified borrowing-base availability.
          Facility terms show the current policy; funded balances use the
          displayed as-of date.
        </p>
      </section>

      <section aria-labelledby="debtors-heading">
        <h2 id="debtors-heading" className="mb-3 text-base font-semibold">
          Debtor exposure
        </h2>
        <div className="border-border bg-card overflow-x-auto rounded-sm border">
          <table className="w-full min-w-[520px] text-sm">
            <caption className="sr-only">
              Client debtor exposure and submitted invoice face values
            </caption>
            <thead className="text-muted-foreground border-b text-left">
              <tr>
                <th className="px-4 py-3 font-medium" scope="col">
                  Debtor
                </th>
                <th className="px-4 py-3 text-right font-medium" scope="col">
                  Invoices
                </th>
                <th className="px-4 py-3 text-right font-medium" scope="col">
                  Submitted face
                </th>
                <th className="px-4 py-3 text-right font-medium" scope="col">
                  Funded outstanding
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {debtors.map((d) => (
                <tr key={d.id}>
                  <th scope="row" className="px-4 py-3 text-left font-medium">
                    {d.name}
                  </th>
                  <td className="num px-4 py-3 text-right">{d.invoiceCount}</td>
                  <td className="num px-4 py-3 text-right">
                    {money(d.submittedFaceCents)}
                  </td>
                  <td className="num px-4 py-3 text-right font-medium">
                    {money(d.fundedOutstandingCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {debtors.length === 0 && (
            <p className="text-muted-foreground p-4 text-sm">
              No debtor records for this client.
            </p>
          )}
        </div>
      </section>


      <section aria-labelledby="ageing-heading">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-primary text-[10px] font-semibold tracking-[0.16em] uppercase">
              Receivables / Collections
            </p>
            <h2
              id="ageing-heading"
              className="mt-1 text-lg font-semibold tracking-tight"
            >
              Debtor ageing
            </h2>
            <p className="text-muted-foreground mt-1 text-xs">
              Outstanding synthetic ledger receivables after dated allocations
              and credit notes. Distinct from funded principal above.
            </p>
          </div>
          <span className="text-muted-foreground text-xs">
            Business as of {businessDate(ageing.asOf)}
          </span>
        </div>
        <dl className="border-border bg-card mb-4 grid rounded-sm border sm:grid-cols-3">
          {[
            { label: "Receivables outstanding", value: ageing.totalOutstandingCents },
            { label: "Past due", value: ageing.overdueCents },
            { label: "Not past due", value: ageing.currentCents },
          ].map((metric) => (
            <div className="border-border border-b p-4 sm:border-r sm:border-b-0" key={metric.label}>
              <dt className="text-muted-foreground text-xs">{metric.label}</dt>
              <dd className="num mt-2 text-xl font-semibold">{money(metric.value)}</dd>
            </div>
          ))}
        </dl>
        <div className="border-border bg-card overflow-x-auto rounded-sm border">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">
              Synthetic debtor receivables ageing by days past due
            </caption>
            <thead className="text-muted-foreground border-b text-xs">
              <tr>
                <th scope="col" className="px-3 py-3 text-left font-medium">Debtor</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Current</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">1–30</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">31–60</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">61–90</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">91+</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {ageing.debtors.map((d) => (
                <tr key={d.debtorId}>
                  <th scope="row" className="px-3 py-3 text-left font-medium">
                    <details>
                      <summary className="text-primary cursor-pointer font-semibold underline-offset-4 hover:underline">
                        {d.debtorName}
                      </summary>
                      <ul className="text-muted-foreground mt-2 space-y-1 text-xs font-normal">
                        {d.invoices.map((invoice) => (
                          <li key={invoice.invoiceId}>
                            {invoice.invoiceId}: {money(invoice.outstandingCents)} outstanding
                            · {invoice.daysPastDue} days past due
                          </li>
                        ))}
                      </ul>
                    </details>
                    <p className="text-muted-foreground mt-1 text-xs font-normal">
                      Receipts, last 30 days: {money(d.paymentsLast30DaysCents)}
                    </p>
                  </th>
                  <td className="num px-3 py-3 text-right">{money(d.buckets.CURRENT)}</td>
                  <td className="num px-3 py-3 text-right">{money(d.buckets.DAYS_1_30)}</td>
                  <td className="num px-3 py-3 text-right">{money(d.buckets.DAYS_31_60)}</td>
                  <td className="num px-3 py-3 text-right">{money(d.buckets.DAYS_61_90)}</td>
                  <td className="num px-3 py-3 text-right">{money(d.buckets.DAYS_90_PLUS)}</td>
                  <td className="num px-3 py-3 text-right font-semibold">
                    {money(d.grossOutstandingCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ageing.debtors.length === 0 && (
            <p className="text-muted-foreground p-6 text-sm">
              No dated synthetic ledger receivables are recorded for this client.
              This is not evidence of a zero real-world balance.
            </p>
          )}
        </div>
        <p className="text-muted-foreground mt-2 text-xs">
          Due dates are estimated from current demo payment terms. Ledger history
          is not a live accounting sync. Figures are descriptive only, not an
          approved borrowing-base availability calculation.
        </p>
      </section>

      <div className="grid gap-7 xl:grid-cols-2">
        <section aria-labelledby="batches-heading">
          <h2 id="batches-heading" className="mb-3 text-base font-semibold">
            Submitted batches
          </h2>
          <ul className="border-border bg-card divide-border divide-y rounded-sm border">
            {batches.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/batches/${b.id}`}
                  className="hover:bg-accent/50 block px-4 py-3 focus-visible:ring-2"
                >
                  <span className="flex items-center justify-between gap-3 text-sm font-semibold">
                    <span>
                      {businessDate(b.submittedDate)} · {b.invoiceCount}{" "}
                      invoices
                    </span>
                    <span className="num">{money(b.faceCents)}</span>
                  </span>
                  <span className="text-muted-foreground mt-1 block text-xs">
                    {b.status.toLowerCase()}
                  </span>
                </Link>
              </li>
            ))}
            {batches.length === 0 && (
              <li className="text-muted-foreground px-4 py-5 text-sm">
                No submitted batches.
              </li>
            )}
          </ul>
        </section>
        <section aria-labelledby="incidents-heading">
          <h2 id="incidents-heading" className="mb-3 text-base font-semibold">
            Risk events
          </h2>
          <ul className="border-border bg-card divide-border divide-y rounded-sm border">
            {incidents.slice(0, 12).map((i) => (
              <li key={i.id}>
                <Link
                  href={`/watch?asOf=${dossier.asOf}&incident=${encodeURIComponent(i.id)}`}
                  className="hover:bg-accent/50 flex items-center justify-between gap-3 px-4 py-3 text-sm focus-visible:ring-2"
                >
                  <span>
                    <span className="font-medium">
                      {i.ruleId.replaceAll("_", " ")}
                    </span>
                    <span className="text-muted-foreground mt-1 block text-xs">
                      {businessDate(i.firstDetectedDate)}
                    </span>
                  </span>
                  <span
                    className={
                      i.severity === "HIGH"
                        ? "text-destructive text-xs font-semibold"
                        : "text-muted-foreground text-xs font-semibold"
                    }
                  >
                    {i.severity}
                  </span>
                </Link>
              </li>
            ))}
            {incidents.length === 0 && (
              <li className="text-muted-foreground px-4 py-5 text-sm">
                No risk incidents.
              </li>
            )}
          </ul>
        </section>
      </div>
      <p className="text-muted-foreground border-t pt-3 text-xs">
        All records are synthetic. This read-only dossier does not include
        historical facility amendments, authenticated client permissions,
        production accounting sync or approved borrowing-base availability.
        Those require the controlled source, identity and policy integrations.
      </p>
    </>
  );
}
