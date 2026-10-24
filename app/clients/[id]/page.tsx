import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { PageHeader, Loading } from "@/components/page";
import { DEMO_TODAY } from "@/lib/demo";
import { businessDate, money, bpsToPercent } from "@/lib/format";
import { getDb } from "@/lib/db/client";
import { getClientDossier } from "@/lib/queries/client-360";

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
  const dossier = await getClientDossier(await getDb(), id, DEMO_TODAY);
  if (!dossier) notFound();
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
        historical facility amendments, documents or source-verified outstanding
        receivables. Those require the approved ingestion and data model.
      </p>
    </>
  );
}
