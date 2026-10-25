import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Loading, PageHeader } from "@/components/page";
import { getDb } from "@/lib/db/client";
import { DEMO_TODAY } from "@/lib/demo";
import { businessDate, money } from "@/lib/format";
import { indicativeClientBorrowingBase } from "@/lib/queries/client-borrowing-base";
import {
  compareScenario,
  parseScenarioParams,
  type ScenarioKey,
} from "@/lib/credit/scenario-comparison";

export default function ClientBorrowingBasePage({
  params,
  searchParams,
}: PageProps<"/clients/[id]/borrowing-base">) {
  return (
    <Suspense
      fallback={<Loading label="Reconciling synthetic receivables..." />}
    >
      <Scenario params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Scenario({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const { id } = await params;
  const result = await indicativeClientBorrowingBase(
    await getDb(),
    id,
    DEMO_TODAY,
  );
  if (!result) notFound();
  const submitted = await searchParams;
  const parsed = parseScenarioParams(submitted);
  const comparison =
    parsed.requested && parsed.valid && result.report
      ? compareScenario(
          result.asOfDate,
          result.baselinePolicy,
          result.sourceReceivables,
          parsed.values,
        )
      : null;
  const rawField = (key: ScenarioKey) =>
    typeof submitted[key] === "string"
      ? submitted[key]
      : String(result.baselinePolicy[key]);

  return (
    <div className="space-y-7">
      <Link
        href={`/clients/${encodeURIComponent(id)}`}
        className="text-primary text-sm underline-offset-4 hover:underline"
      >
        ← Back to Client 360
      </Link>
      <PageHeader
        title="Client collateral scenario"
        description={`Synthetic ledger as of ${businessDate(result.asOfDate)} · No credit-policy approval or live source verification`}
      />
      <div
        role="note"
        className="border-status-flagged bg-status-flagged-bg rounded-sm border p-5"
      >
        <p className="text-status-flagged text-sm font-semibold">
          Illustrative calculation only — NOT drawable credit
        </p>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          The amounts below are calculated from this client’s synthetic ledger
          and allocated receipts, not from a verified borrowing-base
          certificate. Missing source freshness, disputed-debt assessment and
          signed facility policies prevent an authoritative availability
          decision.
        </p>
      </div>

      {result.status === "NO_SOURCE_RECORDS" || !result.report ? (
        <section className="border-border bg-card rounded-sm border p-7">
          <h2 className="text-base font-semibold">
            Source records unavailable
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            No qualifying synthetic invoices are recorded as of this date. An
            unknown balance must not be represented as zero collateral.
          </p>
        </section>
      ) : (
        <>
          <section
            aria-label="Indicative finance position"
            className="grid gap-3 sm:grid-cols-3"
          >
            {[
              {
                label: "Net synthetic receivables",
                value: result.report.netReceivablesCents,
              },
              {
                label: "Scenario eligible collateral",
                value: result.report.eligibleCollateralCents,
              },
              {
                label: "Scenario mathematical headroom",
                value: result.report.availableCents,
              },
            ].map((metric) => (
              <div
                key={metric.label}
                className="border-border bg-card rounded-sm border p-5"
              >
                <p className="text-muted-foreground text-xs">{metric.label}</p>
                <p className="num mt-2 text-2xl font-semibold">
                  {money(metric.value)}
                </p>
              </div>
            ))}
          </section>
          <section
            aria-labelledby="comparison-heading"
            className="border-border bg-card rounded-sm border p-5"
          >
            <h2 id="comparison-heading" className="text-base font-semibold">
              Compare alternative assumptions
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">
              Identical dated client invoices; only hypothetical policy inputs
              change. Values are integer basis points and NZD cents. No
              approved lending decision or real funding is created.
            </p>
            <form
              method="get"
              className="mt-4 grid gap-3 sm:grid-cols-2"
              aria-label="Counterfactual scenario inputs"
            >
              {(
                [
                  ["advanceRateBps", "Advance rate (bps)"],
                  ["maximumDebtorShareBps", "Concentration cap (bps)"],
                  ["reservesCents", "Reserve (NZD cents)"],
                  ["facilityLimitCents", "Illustrative facility cap (NZD cents)"],
                ] as const
              ).map(([key, label]) => (
                <label className="block text-sm" key={key}>
                  <span className="mb-1 block font-medium">{label}</span>
                  <input
                    name={key}
                    type="number"
                    inputMode="numeric"
                    step="1"
                    min="0"
                    max={
                      key === "advanceRateBps" ||
                      key === "maximumDebtorShareBps"
                        ? 10000
                        : undefined
                    }
                    defaultValue={rawField(key)}
                    className="border-input bg-background focus-visible:ring-ring w-full rounded-sm border px-3 py-2 focus-visible:ring-2"
                    aria-invalid={
                      parsed.requested &&
                      !parsed.valid &&
                      parsed.errors.some((error) => error.field === key)
                    }
                    aria-describedby="scenario-errors"
                  />
                </label>
              ))}
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <button
                  type="submit"
                  className="bg-primary text-primary-foreground focus-visible:ring-ring rounded-sm px-4 py-2 text-sm font-semibold focus-visible:ring-2"
                >
                  Compare
                </button>
                <Link
                  href={`/clients/${encodeURIComponent(id)}/borrowing-base`}
                  className="text-primary text-sm underline underline-offset-4"
                >
                  Reset to baseline
                </Link>
              </div>
            </form>
            {parsed.requested && !parsed.valid && (
              <div id="scenario-errors" role="alert" className="mt-3 text-sm text-destructive">
                Invalid scenario: {parsed.errors.map((error) =>
                  `${error.field}: ${error.message}`
                ).join("; ")}
              </div>
            )}
            {comparison && (
              <div className="mt-6 space-y-5">
                <div className="border-border overflow-x-auto rounded-sm border" role="region" tabIndex={0} aria-label="Scenario waterfall comparison">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead className="bg-muted text-left">
                      <tr>
                        <th scope="col" className="p-3">Metric</th>
                        <th scope="col" className="p-3 text-right">Baseline</th>
                        <th scope="col" className="p-3 text-right">Counterfactual</th>
                        <th scope="col" className="p-3 text-right">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.waterfall.map((line) => (
                        <tr key={line.field} className="border-t">
                          <th scope="row" className="p-3 text-left font-medium">
                            {line.field.replace(/Cents$/, "").replace(/([a-z])([A-Z])/g, "$1 $2")}
                          </th>
                          <td className="num p-3 text-right">{money(line.baselineCents)}</td>
                          <td className="num p-3 text-right">{money(line.scenarioCents)}</td>
                          <td className="num p-3 text-right">
                            {line.deltaCents >= 0 ? "+" : "−"}{money(Math.abs(line.deltaCents))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="border-border overflow-x-auto rounded-sm border" role="region" tabIndex={0} aria-label="Per-invoice counterfactual deltas">
                  <table className="w-full min-w-[610px] text-sm">
                    <thead className="bg-muted text-left">
                      <tr>
                        <th scope="col" className="p-3">Source invoice</th>
                        <th scope="col" className="p-3 text-right">Baseline advance</th>
                        <th scope="col" className="p-3 text-right">Scenario advance</th>
                        <th scope="col" className="p-3 text-right">Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.invoices.map((invoice) => (
                        <tr key={invoice.invoiceId} className="border-t">
                          <th scope="row" className="p-3 text-left">
                            {invoice.invoiceId}
                            <span className="text-muted-foreground block text-xs">{invoice.debtorId}</span>
                          </th>
                          <td className="num p-3 text-right">{money(invoice.baselineAdvanceCents)}</td>
                          <td className="num p-3 text-right">{money(invoice.scenarioAdvanceCents)}</td>
                          <td className="num p-3 text-right">
                            {invoice.advanceDeltaCents >= 0 ? "+" : "−"}{money(Math.abs(invoice.advanceDeltaCents))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-muted-foreground text-xs">
                  Baseline: {comparison.baseline.policyVersion}. Counterfactual:
                  {" "}{comparison.counterfactual.policyVersion}. Invoice face
                  amounts, dated receipts, credit notes and source IDs remain
                  unchanged. The final availability delta is not the sum of
                  invoice advances because reserves, existing drawings and
                  facility caps also apply.
                </p>
              </div>
            )}
          </section>
          <section
            aria-labelledby="scenario-waterfall"
            className="border-border bg-card rounded-sm border p-5"
          >
            <h2
              id="scenario-waterfall"
              className="mb-4 text-base font-semibold"
            >
              Receivables-to-headroom reconciliation
            </h2>
            <dl className="divide-border divide-y">
              {[
                {
                  label: "Gross ledger receivables",
                  value: result.report.grossReceivablesCents,
                },
                {
                  label: "Receipts and credits deducted",
                  value: -result.report.receiptsAndCreditsCents,
                },
                {
                  label: "Over-age exclusions",
                  value: -result.report.excludedCents,
                },
                {
                  label: "Illustrative debtor concentration excess",
                  value: -result.report.concentrationExcessCents,
                },
                {
                  label: "Eligible synthetic collateral",
                  value: result.report.eligibleCollateralCents,
                },
                {
                  label: "Gross scenario advance",
                  value: result.report.grossAdvanceCents,
                },
                {
                  label: "Scenario reserves (not verified)",
                  value: -result.report.reservesCents,
                },
                {
                  label: "Secured scenario advance",
                  value: result.report.securedAdvanceCents,
                },
                {
                  label: "Committed headroom",
                  value: result.report.facilityHeadroomCents,
                },
                {
                  label: "Scenario mathematical headroom",
                  value: result.report.availableCents,
                },
                {
                  label: "Excess outstanding versus scenario collateral",
                  value: result.report.overdrawnCents,
                },
              ].map((row) => (
                <div
                  key={row.label}
                  className="flex justify-between gap-4 py-3 text-sm"
                >
                  <dt>{row.label}</dt>
                  <dd className="num font-semibold whitespace-nowrap">
                    {row.value < 0 ? "−" : ""}
                    {money(Math.abs(row.value))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section aria-labelledby="receivable-sources">
            <h2
              id="receivable-sources"
              className="mb-3 text-base font-semibold"
            >
              Source-backed invoice treatment
            </h2>
            <div
              role="region"
              aria-labelledby="receivable-sources"
              tabIndex={0}
              className="border-border bg-card focus-visible:ring-ring overflow-x-auto rounded-sm border focus-visible:ring-2 focus-visible:outline-none"
            >
              <table className="w-full min-w-[680px] text-sm">
                <caption className="sr-only">
                  Synthetic ledger invoice-level eligibility, deductions and
                  scenario advances
                </caption>
                <thead className="text-muted-foreground border-b text-xs">
                  <tr>
                    <th scope="col" className="px-3 py-3 text-left">
                      Source invoice / debtor
                    </th>
                    <th scope="col" className="px-3 py-3 text-right">
                      Net AR
                    </th>
                    <th scope="col" className="px-3 py-3 text-right">
                      Exclusions
                    </th>
                    <th scope="col" className="px-3 py-3 text-right">
                      Concentration
                    </th>
                    <th scope="col" className="px-3 py-3 text-right">
                      Advance
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {result.report.treatments.map((invoice) => (
                    <tr key={invoice.invoiceId}>
                      <th scope="row" className="px-3 py-3 text-left">
                        <span className="font-semibold">
                          {invoice.invoiceId}
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          {invoice.debtorId}
                        </span>
                        {invoice.reasons.length > 0 && (
                          <span className="text-status-flagged mt-1 block text-xs">
                            {invoice.reasons.join(", ")}
                          </span>
                        )}
                      </th>
                      <td className="num px-3 py-3 text-right">
                        {money(invoice.netCents)}
                      </td>
                      <td className="num px-3 py-3 text-right">
                        {money(invoice.excludedCents)}
                      </td>
                      <td className="num px-3 py-3 text-right">
                        {money(invoice.concentrationExcessCents)}
                      </td>
                      <td className="num px-3 py-3 text-right font-semibold">
                        {money(invoice.advanceCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      <section aria-labelledby="scenario-assumptions">
        <h2 id="scenario-assumptions" className="mb-3 text-base font-semibold">
          Required assumptions and limits
        </h2>
        <ul className="text-muted-foreground list-inside list-disc space-y-2 text-sm">
          {result.assumptions.map((assumption) => (
            <li key={assumption}>{assumption}</li>
          ))}
        </ul>
        <p className="text-muted-foreground mt-4 text-xs">
          Credit Desk cannot authorize lending or disbursements from this
          scenario. A financial-policy review, reconciled provider ingestion and
          human independent approval are mandatory.
        </p>
      </section>
    </div>
  );
}
