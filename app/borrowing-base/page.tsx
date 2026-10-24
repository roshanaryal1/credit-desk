import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Loading, PageHeader } from "@/components/page";
import { demonstrationWorksheet, WORKSHEET_DATE } from "@/lib/credit/demo-worksheet";
import { businessDate, money } from "@/lib/format";

export const metadata = { title:"Borrowing-base demonstration" };

export default function BorrowingBasePage({ searchParams }: PageProps<"/borrowing-base">) {
  return (
    <>
      <PageHeader title="Borrowing-base worksheet"
        description="Trace receivable eligibility and policy deductions through to an illustrative funding position." />
      <Suspense fallback={<Loading label="Calculating sample collateral position..." />}>
        <Worksheet searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Worksheet({ searchParams }: { searchParams: PageProps<"/borrowing-base">["searchParams"] }) {
  await connection();
  const sp=await searchParams;
  const scenario = sp.scenario === "low-draw" ? "low-draw" : "baseline";
  const r = demonstrationWorksheet(scenario);
  const steps = [
    {label:"Gross submitted receivables",value:r.grossReceivablesCents,negative:false},
    {label:"Allocated receipts and credit notes",value:r.receiptsAndCreditsCents,negative:true},
    {label:"Ineligible net receivables",value:r.excludedCents,negative:true},
    {label:"Debtor concentration excess",value:r.concentrationExcessCents,negative:true},
    {label:"Eligible collateral",value:r.eligibleCollateralCents,negative:false,strong:true},
    {label:"Gross advance at per-invoice rate",value:r.grossAdvanceCents,negative:false},
    {label:"Facility reserves",value:r.reservesCents,negative:true},
    {label:"Secured advance value",value:r.securedAdvanceCents,negative:false,strong:true},
  ];
  return (
    <div className="space-y-7">
      <div className="border-status-flagged bg-status-flagged-bg rounded-sm border p-4">
        <p className="text-status-flagged text-sm font-semibold">Illustrative scenario — not drawable funding</p>
        <p className="text-status-flagged mt-1 text-xs leading-relaxed">
          These are hand-prepared synthetic invoice figures, not live client balances, ledger imports or an approved facility policy. The screen cannot authorise a disbursement.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-primary text-xs font-semibold tracking-widest uppercase">Collateral analysis / Demo</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">Availability reconciliation</h2>
          <p className="text-muted-foreground mt-1 text-xs">As of {businessDate(WORKSHEET_DATE)} · Policy {r.policyVersion}</p>
        </div>
        <nav aria-label="Synthetic drawdown scenario" className="flex gap-2">
          <Link href="/borrowing-base" aria-current={scenario === "baseline" ? "page" : undefined}
            className={scenario === "baseline" ? "bg-primary text-primary-foreground rounded-sm px-3 py-2 text-xs font-semibold" : "border-border rounded-sm border px-3 py-2 text-xs"}>
            High utilisation
          </Link>
          <Link href="/borrowing-base?scenario=low-draw"
            aria-current={scenario === "low-draw" ? "page" : undefined}
            className={scenario === "low-draw" ? "bg-primary text-primary-foreground rounded-sm px-3 py-2 text-xs font-semibold" : "border-border rounded-sm border px-3 py-2 text-xs"}>
            Lower utilisation
          </Link>
        </nav>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {label:"Eligible collateral",value:r.eligibleCollateralCents},
          {label:"Drawn",value:scenario === "baseline" ? 35000 : 2000},
          {label:"Illustrative available",value:r.availableCents},
        ].map((x) => <div key={x.label} className="border-border bg-card rounded-sm border p-5">
          <p className="text-muted-foreground text-xs">{x.label}</p>
          <p className="num mt-2 text-2xl font-semibold">{money(x.value)}</p>
        </div>)}
      </div>
      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)]">
        <section aria-labelledby="waterfall-heading">
          <h2 id="waterfall-heading" className="mb-3 text-base font-semibold">Eligibility waterfall</h2>
          <dl className="border-border bg-card divide-border divide-y rounded-sm border">
            {steps.map(x => <div key={x.label} className={x.strong ? "bg-muted/50 flex justify-between gap-2 px-4 py-3 font-semibold" : "flex justify-between gap-2 px-4 py-3"}>
              <dt className="text-sm">{x.label}</dt>
              <dd className="num whitespace-nowrap text-sm">{x.negative ? "−" : ""}{money(x.value)}</dd>
            </div>)}
          </dl>
          <div className="border-primary bg-accent mt-3 rounded-sm border p-5">
            <div className="flex items-end justify-between gap-3">
              <span className="text-sm font-semibold">Available under illustration</span>
              <span className="num text-2xl font-semibold">{money(r.availableCents)}</span>
            </div>
            <p className="text-muted-foreground mt-2 text-xs">After existing drawings, facility commitment and sublimit restrictions.</p>
            {r.overdrawnCents > 0 ? (
              <p className="text-destructive mt-2 text-xs font-semibold">
                This scenario is overdrawn against collateral by {money(r.overdrawnCents)}.
              </p>
            ) : null}
          </div>
        </section>
        <section aria-labelledby="treatment-heading" className="min-w-0">
          <h2 id="treatment-heading" className="mb-3 text-base font-semibold">Receivable treatment</h2>
          <div className="border-border bg-card overflow-x-auto rounded-sm border">
            <table className="w-full min-w-[650px] text-sm">
              <caption className="sr-only">Illustrative invoice eligibility and advances, in NZD</caption>
              <thead className="text-muted-foreground border-b text-xs">
                <tr>
                  <th className="px-3 py-3 text-left font-medium" scope="col">Invoice / debtor</th>
                  <th className="px-3 py-3 text-right font-medium" scope="col">Net AR</th>
                  <th className="px-3 py-3 text-right font-medium" scope="col">Excluded</th>
                  <th className="px-3 py-3 text-right font-medium" scope="col">Concentration</th>
                  <th className="px-3 py-3 text-right font-medium" scope="col">Advance</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {r.treatments.map(x => <tr key={x.invoiceId}>
                  <th scope="row" className="px-3 py-3 text-left">
                    <span className="font-semibold">{x.invoiceId}</span>
                    <span className="text-muted-foreground block text-xs">{x.debtorId}</span>
                    {x.reasons.length ? <span className="text-status-flagged mt-1 block text-xs">{x.reasons.join(", ")}</span> : null}
                  </th>
                  <td className="num px-3 py-3 text-right">{money(x.netCents)}</td>
                  <td className="num px-3 py-3 text-right">{money(x.excludedCents)}</td>
                  <td className="num px-3 py-3 text-right">{money(x.concentrationExcessCents)}</td>
                  <td className="num px-3 py-3 text-right font-semibold">{money(x.advanceCents)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground mt-2 text-xs">All treatments and rates are synthetic and governed by proposed ADR-0007. The credit team must approve real facility rules before connection.</p>
        </section>
      </div>
    </div>
  );
}
