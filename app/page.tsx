import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Loading, PageHeader, Section } from "@/components/page";
import { DEMO_TODAY } from "@/lib/demo";
import { businessDate, money } from "@/lib/format";
import { listBatches, listClients } from "@/lib/queries/book";

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        title="Overview"
        description={`The desk as of ${businessDate(DEMO_TODAY)}: facility use, batches waiting for review, and where to look first.`}
      />
      <Suspense fallback={<Loading label="Loading the desk..." />}>
        <OverviewData />
      </Suspense>
    </>
  );
}

async function OverviewData() {
  await connection();
  const [clients, batches] = await Promise.all([listClients(), listBatches()]);
  const pending = batches.filter((b) => b.status === "PENDING");
  return (
    <>
      <Section
        title="Funds in use"
        description="Outstanding advances against each client's facility limit."
      >
        <ul className="bg-card divide-y rounded-md border">
          {clients.map((c) => {
            const share = c.fundsInUseCents / c.facilityLimitCents;
            return (
              <li
                key={c.id}
                className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-muted-foreground text-xs capitalize">
                    {c.industry}
                  </p>
                </div>
                <p className="num text-sm sm:text-right">
                  {money(c.fundsInUseCents)}{" "}
                  <span className="text-muted-foreground">
                    of {money(c.facilityLimitCents)}
                  </span>
                </p>
                <div
                  className="bg-muted h-1.5 overflow-hidden rounded sm:col-span-2"
                  role="img"
                  aria-label={`${Math.round(share * 100)}% of facility in use`}
                >
                  <div
                    className={
                      share > 0.9
                        ? "bg-destructive h-full"
                        : "bg-primary h-full"
                    }
                    style={{ width: `${Math.min(100, share * 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section
        title="Waiting for review"
        description="Funding batches submitted by clients that no one has reviewed yet."
      >
        {pending.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No batches are waiting. New submissions appear here.
          </p>
        ) : (
          <ul className="bg-card divide-y rounded-md border">
            {pending.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/batches/${b.id}`}
                  className="hover:bg-accent focus-visible:ring-ring grid gap-1 px-4 py-3 focus-visible:ring-2 focus-visible:outline-none sm:grid-cols-[1fr_auto]"
                >
                  <span className="font-medium">{b.clientName}</span>
                  <span className="num text-sm sm:text-right">
                    {money(b.faceCents)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    Submitted {businessDate(b.submittedDate)}, {b.invoiceCount}{" "}
                    invoices
                  </span>
                  <span className="text-muted-foreground text-xs sm:text-right">
                    {b.highRisk} high risk, {b.flagged} flagged
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
