import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { PageHeader, Loading } from "@/components/page";
import { DEMO_TODAY } from "@/lib/demo";
import { businessDate, money } from "@/lib/format";
import { listBatches } from "@/lib/queries/book";
import { incidentsAsOf } from "@/lib/queries/watch";
import { workItems } from "@/lib/queue/work-items";

export const metadata = { title: "Review queue" };

export default function QueuePage({ searchParams }: PageProps<"/queue">) {
  return (
    <>
      <PageHeader
        title="Review queue"
        description="A single point of attention for unreviewed invoice batches and unresolved portfolio exceptions."
      />
      <Suspense fallback={<Loading label="Building review queue..." />}>
        <QueueData searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function QueueData({
  searchParams,
}: {
  searchParams: PageProps<"/queue">["searchParams"];
}) {
  await connection();
  const sp = await searchParams;
  const requested = sp.type;
  const type =
    requested === "invoice" || requested === "risk" ? requested : "all";
  const [batches, incidents] = await Promise.all([
    listBatches(),
    incidentsAsOf(DEMO_TODAY),
  ]);
  const all = workItems(batches, incidents, DEMO_TODAY);
  const showing = all.filter(
    (item) =>
      type === "all" ||
      (type === "invoice"
        ? item.kind === "INVOICE_BATCH"
        : item.kind === "RISK_INCIDENT"),
  );
  return (
    <div className="space-y-6">
      <div className="border-border bg-card flex flex-col justify-between gap-3 rounded-sm border p-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
            Desk position
          </p>
          <p className="mt-1 text-sm font-semibold">
            {businessDate(DEMO_TODAY)} · Synthetic records
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            This is a read-only triage view, not an assigned case system. No SLA
            or owner is claimed.
          </p>
        </div>
        <p className="num text-2xl font-semibold">
          {all.length}{" "}
          <span className="text-muted-foreground text-sm font-normal">
            items
          </span>
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border p-4">
        <div>
          <p className="text-sm font-semibold">
            Assigned synthetic case examples
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Persisted fictional owners, deadlines and checker-review states. No
            genuine user approval or settlement authority.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/queue/sla"
            className="text-primary focus-visible:ring-ring rounded-sm border px-4 py-2 text-sm font-semibold focus-visible:ring-2"
          >
            View fictional SLA monitor →
          </Link>
        </div>
        <Link
          href="/queue/cases"
          className="text-primary focus-visible:ring-ring rounded-sm border px-4 py-2 text-sm font-semibold focus-visible:ring-2"
        >
          Open case workboard →
        </Link>
      </div>
      <nav aria-label="Queue filter" className="flex flex-wrap gap-2">
        {[
          { key: "all", label: "All work" },
          { key: "invoice", label: "Invoice review" },
          { key: "risk", label: "Risk exceptions" },
        ].map((t) => (
          <Link
            key={t.key}
            href={t.key === "all" ? "/queue" : `/queue?type=${t.key}`}
            aria-current={t.key === type ? "page" : undefined}
            className={
              t.key === type
                ? "border-primary bg-accent rounded-sm border px-3 py-2 text-sm font-semibold"
                : "border-border hover:bg-accent/60 rounded-sm border px-3 py-2 text-sm"
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <section
        aria-label="Review items"
        className="border-border bg-card overflow-hidden rounded-sm border"
      >
        {showing.length === 0 ? (
          <p className="text-muted-foreground p-8 text-sm">
            No matching work at this as-of date.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {showing.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="hover:bg-accent/50 grid gap-3 px-5 py-4 focus-visible:ring-2 md:grid-cols-[110px_minmax(0,1fr)_auto] md:items-center"
                >
                  <div className="space-y-1">
                    <p
                      className={
                        item.severity === "HIGH"
                          ? "text-destructive text-xs font-semibold"
                          : "text-muted-foreground text-xs font-semibold"
                      }
                    >
                      {item.severity} PRIORITY
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {businessDate(item.date)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{item.clientName}</p>
                    <p className="text-muted-foreground mt-1 text-xs capitalize">
                      {item.description}
                    </p>
                    <p className="text-primary mt-2 text-xs font-medium">
                      {item.nextStep} →
                    </p>
                  </div>
                  <div className="text-sm md:text-right">
                    {item.amountCents !== null ? (
                      <>
                        <p className="num font-semibold">
                          {money(item.amountCents)}
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {item.amountLabel}
                        </p>
                      </>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        Exposure not calculated
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-muted-foreground text-xs">
        Future: verified user assignments, deadlines, approvals and escalation
        history are governed by #105/#109 and must not be simulated as real
        workflow state.
      </p>
    </div>
  );
}
