import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Loading, PageHeader } from "@/components/page";
import { getDb } from "@/lib/db/client";
import { DEMO_TODAY } from "@/lib/demo";
import { businessDate } from "@/lib/format";
import {
  CASE_FILTERS,
  listDemoCases,
  type CaseViewFilter,
} from "@/lib/queries/demo-cases";

export const metadata = { title: "Synthetic case workboard" };
const FILTER_LABELS: Record<CaseViewFilter, string> = {
  all: "All cases",
  unassigned: "Unassigned",
  checker: "Checker inbox",
  overdue: "Overdue",
};

export default function CaseWorkboard({
  searchParams,
}: PageProps<"/queue/cases">) {
  return (
    <Suspense fallback={<Loading label="Loading fictional case assignments..." />}>
      <CaseList searchParams={searchParams} />
    </Suspense>
  );
}

async function CaseList({
  searchParams,
}: {
  searchParams: PageProps<"/queue/cases">["searchParams"];
}) {
  await connection();
  const sp = await searchParams;
  const filter: CaseViewFilter =
    typeof sp.filter === "string" && CASE_FILTERS.includes(sp.filter as CaseViewFilter)
      ? sp.filter as CaseViewFilter
      : "all";
  const rows = await listDemoCases(await getDb(), filter, DEMO_TODAY);
  return (
    <>
      <Link
        href="/queue"
        className="text-primary text-sm underline-offset-4 hover:underline"
      >
        ← Invoice and incident triage
      </Link>
      <PageHeader
        title="Synthetic case workboard"
        description={"Persisted fictional case states · " + businessDate(DEMO_TODAY)}
      />
      <div className="border-border bg-card rounded-sm border p-5">
        <p className="text-sm font-semibold">
          These are not operational assignments or approvals.
        </p>
        <p className="text-muted-foreground mt-2 text-sm">
          This read-only view is backed by the synthetic credit-case database,
          with named fictional assignees, stored versions, priorities and dates.
          A selected checker persona does not confer verified checker authority.
          Real maker–checker transitions remain disabled until enterprise
          identity, MFA and permission checks are connected.
        </p>
      </div>
      <nav aria-label="Case filters" className="flex flex-wrap gap-2">
        {CASE_FILTERS.map((key) => (
          <Link
            key={key}
            href={key === "all" ? "/queue/cases" : "/queue/cases?filter=" + key}
            aria-current={filter === key ? "page" : undefined}
            className={
              "focus-visible:ring-ring rounded-sm border px-3 py-2 text-sm focus-visible:ring-2 " +
              (filter === key ? "border-primary bg-accent font-semibold" : "border-border hover:bg-accent/60")
            }
          >
            {FILTER_LABELS[key]}
          </Link>
        ))}
      </nav>
      <section aria-labelledby="cases-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="cases-heading" className="text-base font-semibold">
            Recorded case states
          </h2>
          <span className="text-muted-foreground text-xs">
            {rows.length} matching cases
          </span>
        </div>
        <ul className="border-border bg-card divide-border divide-y rounded-sm border">
          {rows.map((row) => (
            <li key={row.id} className="grid gap-3 p-5 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <p className="text-sm font-semibold">{row.clientName}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {row.subjectType} {row.subjectId} · {row.id}
                </p>
                <p className="mt-2 text-xs">
                  <strong>{row.state.replaceAll("_", " ")}</strong>
                  {" · "}
                  Priority {row.priority.toLowerCase()}
                  {" · "}
                  Version {row.version}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Fictional assignee: {row.ownerId ?? "unassigned"}
                  {" · "}
                  Due: {row.dueDate ? businessDate(row.dueDate) : "not set"}
                </p>
              </div>
              <Link
                href={"/clients/" + encodeURIComponent(row.clientId)}
                className="text-primary focus-visible:ring-ring self-start rounded-sm border px-3 py-2 text-xs font-semibold focus-visible:ring-2"
              >
                Client evidence →
              </Link>
            </li>
          ))}
          {rows.length === 0 && (
            <li className="text-muted-foreground p-6 text-sm">
              No persisted synthetic cases match this filter. If this is an
              unseeded environment, there are no examples to display; do not
              interpret it as a fully cleared queue.
            </li>
          )}
        </ul>
      </section>
    </>
  );
}
