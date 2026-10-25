import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Loading, PageHeader } from "@/components/page";
import { getDb } from "@/lib/db/client";
import { DEMO_TODAY } from "@/lib/demo";
import { businessDate } from "@/lib/format";
import { listDemoCases } from "@/lib/queries/demo-cases";
import {
  syntheticCaseSlaQueue,
  SYNTHETIC_SLA_POLICY,
} from "@/lib/workflow/case-sla";

export const metadata = { title: "Synthetic case SLA" };

export default function CaseSlaPage() {
  return (
    <Suspense fallback={<Loading label="Calculating fictional case deadlines..." />}>
      <CaseSlaView />
    </Suspense>
  );
}

async function CaseSlaView() {
  await connection();
  const cases = await listDemoCases(await getDb(), "all", DEMO_TODAY);
  const rows = syntheticCaseSlaQueue(cases, DEMO_TODAY);
  const critical = rows.filter((row) => row.stage === "CRITICAL").length;
  const breached = rows.filter((row) => row.stage === "BREACHED").length;
  return (
    <div className="space-y-6">
      <Link
        href="/queue/cases"
        className="text-primary text-sm underline underline-offset-4"
      >
        ← Fictional case workboard
      </Link>
      <PageHeader
        title="Fictional case due-date monitor"
        description={`Date ${businessDate(DEMO_TODAY)} · read-only ${SYNTHETIC_SLA_POLICY.version}`}
      />
      <section className="border-border bg-card rounded-sm border p-5">
        <p className="font-semibold">Synthetic SLA demonstration only</p>
        <p className="text-muted-foreground mt-2 text-sm">
          Deadline stages use Monday–Friday calendar days and the fictional
          policy below. No official NZ public holidays or lender service
          schedules have been supplied, so the results are NOT contractual
          SLA breaches. No notices are delivered, and this self-selected demo
          persona has no authority to assign or approve cases.
        </p>
        <p className="text-muted-foreground mt-2 text-xs">
          Warning after {SYNTHETIC_SLA_POLICY.warningBusinessDays} working
          day(s); critical after
          {" "}{SYNTHETIC_SLA_POLICY.criticalBusinessDays}. Staff identity
          and holiday approval require separate verification.
        </p>
      </section>
      <section aria-label="Synthetic due-date pulse">
        <dl className="border-border bg-card grid rounded-sm border sm:grid-cols-3">
          {[
            ["Fictional cases", rows.length],
            ["Potential critical cases", critical],
            ["Potential breached cases", breached],
          ].map(([label, value]) => (
            <div className="border-border border-b p-4 sm:border-r" key={label}>
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="num mt-1 text-2xl font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="case-sla-heading">
        <h2 id="case-sla-heading" className="mb-3 text-base font-semibold">
          Case due-date classifications
        </h2>
        <ul className="border-border bg-card divide-border divide-y rounded-sm border">
          {rows.map((row) => (
            <li key={row.caseId} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <p className="text-sm font-semibold">{row.clientName}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {row.caseId} · {row.state.replaceAll("_", " ")}
                  {" · "}{row.priority} priority
                </p>
                <p className="mt-2 text-sm font-semibold">{row.stage.replaceAll("_", " ")}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {row.businessDaysLate} counted weekdays after due date
                  {" · "}Due:
                  {" "}{row.dueDate ? businessDate(row.dueDate) : "UNKNOWN"}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Synthetic owner: {row.ownerId ?? "unassigned"}
                  {" · "}Calendar: {row.calendarEvidence}
                </p>
              </div>
              <Link
                href={"/clients/" + encodeURIComponent(row.clientId)}
                className="text-primary focus-visible:ring-ring self-start rounded-sm border px-3 py-2 text-xs font-semibold focus-visible:ring-2"
              >
                View fictional client →
              </Link>
            </li>
          ))}
          {!rows.length && (
            <li className="text-muted-foreground p-6 text-sm">
              No synthetic case records have been seeded. This does not
              establish that a real analyst queue is empty.
            </li>
          )}
        </ul>
      </section>
      <p className="text-muted-foreground text-xs">
        Potential reminder IDs are computed but never dispatched. Durable,
        exactly-once escalation, real business calendars, verified maker-checker
        identities and deadlines remain outstanding under #105 and #109.
      </p>
    </div>
  );
}
