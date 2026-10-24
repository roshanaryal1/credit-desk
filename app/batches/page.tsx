import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Chip } from "@/components/chips";
import { Loading, PageHeader } from "@/components/page";
import { businessDate, money } from "@/lib/format";
import { listBatches } from "@/lib/queries/book";

export const metadata = { title: "Invoice Check" };

export default function BatchesPage() {
  return (
    <>
      <PageHeader
        title="Invoice Check"
        description="Funding batches by client. Every invoice is checked against the client's ledger, bank receipts and debtor history before funding."
      />
      <Suspense fallback={<Loading label="Loading batches..." />}>
        <BatchTable />
      </Suspense>
    </>
  );
}

async function BatchTable() {
  await connection();
  const batches = await listBatches();
  return (
    <div className="bg-card overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <caption className="sr-only">Funding batches</caption>
        <thead className="text-muted-foreground border-b text-left">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">
              Client
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Submitted
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Review
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Invoices
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Face value
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Flags
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {batches.map((b) => (
            <tr key={b.id} className="hover:bg-accent/60">
              <td className="px-4 py-2.5">
                <Link
                  href={`/batches/${b.id}`}
                  className="focus-visible:ring-ring font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                >
                  {b.clientName}
                </Link>
              </td>
              <td className="px-4 py-2.5 whitespace-nowrap">
                {businessDate(b.submittedDate)}
              </td>
              <td className="px-4 py-2.5">
                {b.status === "PENDING" ? (
                  <Chip tone="info">Waiting</Chip>
                ) : (
                  <Chip tone="neutral">Reviewed</Chip>
                )}
              </td>
              <td className="num px-4 py-2.5 text-right">{b.invoiceCount}</td>
              <td className="num px-4 py-2.5 text-right">
                {money(b.faceCents)}
              </td>
              <td className="num px-4 py-2.5 text-right whitespace-nowrap">
                {b.highRisk > 0 ? (
                  <Chip tone="high">{b.highRisk} high</Chip>
                ) : null}{" "}
                {b.flagged > 0 ? (
                  <Chip tone="flagged">{b.flagged} flagged</Chip>
                ) : null}
                {b.highRisk + b.flagged === 0 ? (
                  <span className="text-muted-foreground">None</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
