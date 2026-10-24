import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { DecisionChip, StatusChip } from "@/components/chips";
import { InvoicePanel } from "@/components/invoice-panel";
import { Loading, PageHeader, Section } from "@/components/page";
import { bpsToPercent, businessDate, money } from "@/lib/format";
import { getBatch } from "@/lib/queries/book";

export default async function BatchPage({
  params,
  searchParams,
}: PageProps<"/batches/[id]">) {
  return (
    <Suspense fallback={<Loading label="Loading batch..." />}>
      <BatchData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function BatchData({ params, searchParams }: PageProps<"/batches/[id]">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  const selected = typeof sp.invoice === "string" ? sp.invoice : null;
  const data = await getBatch(id);
  if (!data) notFound();
  const { batch, client, invoices, summary, concentration } = data;

  return (
    <>
      <PageHeader
        title={client.name}
        description={`Batch ${batch.id}, submitted ${businessDate(batch.submittedDate)}. Advance rate ${bpsToPercent(client.advanceRateBps)}.`}
      >
        <Link
          href="/batches"
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        >
          All batches
        </Link>
      </PageHeader>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
        <Figure
          label="Face value"
          value={money(summary.faceCents)}
          note={`${invoices.length} invoices`}
        />
        <Figure
          label="Flagged value"
          value={money(summary.flaggedCents)}
          note={`${invoices.filter((i) => i.status !== "CLEAR").length} invoices need a look`}
        />
        <Figure
          label="Clear invoices at advance rate"
          value={money(summary.potentialFundableCents)}
          note="If every clear invoice is approved"
        />
        <Figure
          label="Fundable now"
          value={money(summary.fundableCents)}
          note={`${summary.approvedCount} approved, capped at ${money(summary.headroomCents)} headroom`}
          total
        />
      </dl>

      <Section
        title="Debtor concentration"
        description="Share of this batch's face value by debtor. The concentration check flags a debtor over 30% of the client's book plus this batch."
      >
        <div
          className="bg-muted flex h-3 overflow-hidden rounded"
          role="img"
          aria-label="Debtor concentration bar"
        >
          {concentration.map((d, i) => (
            <div
              key={d.debtorId}
              title={`${d.name}: ${bpsToPercent(d.shareBps)}`}
              className={
                d.shareBps > 3000
                  ? "bg-destructive"
                  : i % 2 === 0
                    ? "bg-primary"
                    : "bg-chart-2"
              }
              style={{ width: `${d.shareBps / 100}%` }}
            />
          ))}
        </div>
        <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {concentration.slice(0, 6).map((d) => (
            <li key={d.debtorId} className="flex justify-between gap-3">
              <span className="truncate">{d.name}</span>
              <span className="num text-muted-foreground">
                {bpsToPercent(d.shareBps)}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Section
          title="Invoices"
          description="Select an invoice to see its checks, the evidence and the decision."
        >
          <div className="bg-card overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <caption className="sr-only">Invoices in this batch</caption>
              <thead className="text-muted-foreground border-b text-left">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Invoice
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Debtor
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Decision
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className={
                      inv.id === selected ? "bg-accent" : "hover:bg-accent/60"
                    }
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/batches/${batch.id}?invoice=${inv.id}`}
                        scroll={false}
                        aria-current={inv.id === selected ? "true" : undefined}
                        className="focus-visible:ring-ring font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {inv.invoiceNumber}
                      </Link>
                    </td>
                    <td className="max-w-48 truncate px-3 py-2">
                      {inv.debtorName}
                    </td>
                    <td className="px-3 py-2">
                      <StatusChip status={inv.status} />
                    </td>
                    <td className="px-3 py-2">
                      {inv.decision ? (
                        <DecisionChip decision={inv.decision} />
                      ) : (
                        <span className="text-muted-foreground">Open</span>
                      )}
                    </td>
                    <td className="num px-3 py-2 text-right">
                      {money(inv.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        {selected ? (
          <Suspense
            key={selected}
            fallback={<Loading label="Loading invoice..." />}
          >
            <InvoicePanel invoiceId={selected} batchId={batch.id} />
          </Suspense>
        ) : (
          <aside className="text-muted-foreground hidden rounded-md border border-dashed p-6 text-sm xl:block">
            Select an invoice to review it. Flagged invoices come with the
            checks that fired and the evidence behind them.
          </aside>
        )}
      </div>
    </>
  );
}

function Figure({
  label,
  value,
  note,
  total,
}: {
  label: string;
  value: string;
  note?: string;
  total?: boolean;
}) {
  return (
    <div>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="mt-1">
        <span
          className={`num text-xl font-semibold ${total ? "total-rule" : ""}`}
        >
          {value}
        </span>
        {note ? (
          <span className="text-muted-foreground mt-1 block text-xs">
            {note}
          </span>
        ) : null}
      </dd>
    </div>
  );
}
