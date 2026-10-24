import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { Loading, PageHeader } from "@/components/page";
import { DEMO_TODAY } from "@/lib/demo";
import { businessDate, money } from "@/lib/format";
import { getDb } from "@/lib/db/client";
import { clientBorrowingReview } from "@/lib/queries/client-borrowing-review";

export const metadata = { title: "Client collateral review" };

export default function ClientBorrowingBase({
  params,
}: PageProps<"/borrowing-base/clients/[id]">) {
  return (
    <Suspense fallback={<Loading label="Reconciling synthetic receivables..." />}>
      <ClientCollateralReview params={params} />
    </Suspense>
  );
}

async function ClientCollateralReview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  const data = await clientBorrowingReview(await getDb(), id, DEMO_TODAY);
  if (!data) notFound();
  const r = data.report;
  const steps = [
    ["Gross ledger receivables", r.grossReceivablesCents],
    ["Less: receipts and credits", -r.receiptsAndCreditsCents],
    ["Less: excluded balances", -r.excludedCents],
    ["Less: debtor concentration excess", -r.concentrationExcessCents],
    ["Indicative eligible collateral", r.eligibleCollateralCents],
    ["Indicative gross advance", r.grossAdvanceCents],
    ["Sandbox reserves (unverified)", -r.reservesCents],
    ["Indicative secured advance value", r.securedAdvanceCents],
  ] as const;
  return (
    <div className="space-y-7">
      <Link
        href={`/clients/${encodeURIComponent(id)}`}
        className="text-primary text-sm underline-offset-4 hover:underline"
      >
        ← Client relationship
      </Link>
      <PageHeader
        title="Client collateral reconciliation"
        description={`${data.clientName} · synthetic accounting and funding position as of ${businessDate(data.asOf)}`}
      />
      <div role="note" className="border-status-flagged bg-status-flagged-bg rounded-sm border p-5">
        <p className="text-status-flagged text-sm font-semibold">
          Preliminary scenario — NOT verified for drawing
        </p>
        <p className="text-status-flagged mt-2 text-xs leading-relaxed">
          This view uses actual seeded client ledger records, not the separate
          four-invoice example. Source refresh, underwriting eligibility,
          concentration, reserves and approvals are not validated. No amount on
          this page is a funding commitment.
        </p>
      </div>

      <section aria-labelledby="recon-summary">
        <h2 id="recon-summary" className="mb-3 text-base font-semibold">
          Evidence-led collateral analysis
        </h2>
        <dl className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Synthetic receivables", cents: data.ageing.totalOutstandingCents },
            { label: "Funded principal in use", cents: data.policy.drawnCents },
            { label: "Indicative extra capacity", cents: r.availableCents },
          ].map((item) => (
            <div key={item.label} className="border-border bg-card rounded-sm border p-4">
              <dt className="text-muted-foreground text-xs">{item.label}</dt>
              <dd className="num mt-2 text-xl font-semibold">{money(item.cents)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground mt-2 text-xs">
          Indicative extra capacity is a sandbox calculation only; it is not
          drawable availability or an automated approval.
        </p>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <section aria-labelledby="waterfall">
          <h2 id="waterfall" className="mb-3 text-base font-semibold">
            Borrowing-base waterfall
          </h2>
          <dl className="border-border bg-card divide-border divide-y rounded-sm border">
            {steps.map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-3 px-4 py-3">
                <dt className="text-sm">{label}</dt>
                <dd className="num text-sm font-semibold whitespace-nowrap">
                  {value < 0 ? "−" : ""}{money(Math.abs(value))}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground mt-2 text-xs">
            Calculation: {r.policyVersion}. The 50% debtor cap and zero
            reserves are *unapproved scenario inputs*, not client contract terms.
          </p>
        </section>
        <section aria-labelledby="treatments" className="min-w-0">
          <h2 id="treatments" className="mb-3 text-base font-semibold">
            Dated invoice evidence
          </h2>
          <div className="border-border bg-card overflow-x-auto rounded-sm border">
            <table className="w-full min-w-[600px] text-sm">
              <caption className="sr-only">
                Invoice-level as-of collateral adjustments in NZD
              </caption>
              <thead className="text-muted-foreground border-b text-xs">
                <tr>
                  <th scope="col" className="px-3 py-3 text-left font-medium">Ledger ID / reason</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">Net AR</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">Excluded</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">Concentration</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">Advance</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {r.treatments.map((row) => (
                  <tr key={row.invoiceId}>
                    <th scope="row" className="px-3 py-3 text-left font-medium">
                      <span>{row.invoiceId}</span>
                      <span className="text-muted-foreground mt-1 block text-xs font-normal">
                        {row.reasons.length ? row.reasons.join(" · ") : "Status checked in seeded ledger"}
                      </span>
                    </th>
                    <td className="num px-3 py-3 text-right">{money(row.netCents)}</td>
                    <td className="num px-3 py-3 text-right">{money(row.excludedCents)}</td>
                    <td className="num px-3 py-3 text-right">{money(row.concentrationExcessCents)}</td>
                    <td className="num px-3 py-3 text-right">{money(row.advanceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.treatments.length === 0 && (
              <p className="text-muted-foreground px-4 py-6 text-sm">
                No recorded receivables at this business date. A missing source
                is not proof of zero real-world receivables.
              </p>
            )}
          </div>
        </section>
      </div>
      <section aria-labelledby="gates-heading" className="border-border bg-card rounded-sm border p-5">
        <h2 id="gates-heading" className="text-sm font-semibold">
          Release restrictions
        </h2>
        <ul className="text-muted-foreground mt-3 list-inside list-disc space-y-2 text-sm">
          {data.blockers.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>
    </div>
  );
}
