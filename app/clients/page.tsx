import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Loading, PageHeader } from "@/components/page";
import { money, bpsToPercent } from "@/lib/format";
import { listClients } from "@/lib/queries/book";

export const metadata = { title: "Client relationships" };

export default function ClientsPage() {
  return (
    <>
      <PageHeader title="Client relationships"
        description="Synthetic lending relationships. Open a client dossier to trace funding exposure and source records." />
      <Suspense fallback={<Loading label="Loading clients..." />}>
        <ClientDirectory />
      </Suspense>
    </>
  );
}

async function ClientDirectory() {
  await connection();
  const clients = await listClients();
  return (
    <section aria-label="Client directory" className="border-border bg-card overflow-x-auto rounded-sm border">
      {clients.length === 0 ? <p className="text-muted-foreground p-8 text-sm">No client records.</p> : (
        <table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">Synthetic client relationships and facility exposure</caption>
          <thead className="text-muted-foreground border-b text-left text-xs">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Client</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Facility</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Funds in use</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Advance rate</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {clients.map(c => (
              <tr key={c.id} className="hover:bg-accent/50">
                <td className="px-4 py-3">
                  <Link className="text-primary font-semibold underline-offset-4 hover:underline focus-visible:ring-2" href={`/clients/${encodeURIComponent(c.id)}`}>{c.name}</Link>
                  <p className="text-muted-foreground mt-1 text-xs capitalize">{c.industry}</p>
                </td>
                <td className="num px-4 py-3 text-right">{money(c.facilityLimitCents)}</td>
                <td className="num px-4 py-3 text-right">{money(c.fundsInUseCents)}</td>
                <td className="num px-4 py-3 text-right">{bpsToPercent(c.advanceRateBps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
