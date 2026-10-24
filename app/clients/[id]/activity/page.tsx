import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { Loading, PageHeader } from "@/components/page";
import { DEMO_TODAY } from "@/lib/demo";
import { businessDate } from "@/lib/format";
import { getDb } from "@/lib/db/client";
import { getClientActivity } from "@/lib/queries/client-activity";

export const metadata = { title: "Client activity · Credit Desk" };

export default function ClientActivityPage({
  params,
  searchParams,
}: PageProps<"/clients/[id]/activity">) {
  return (
    <Suspense fallback={<Loading label="Loading synthetic client history..." />}>
      <Activity params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Activity({
  params,
  searchParams,
}: PageProps<"/clients/[id]/activity">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  const pageNumber = typeof sp.page === "string" && /^[1-9]\d{0,3}$/.test(sp.page)
    ? Number(sp.page) : 1;
  const asOf = typeof sp.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.asOf) &&
    sp.asOf <= DEMO_TODAY &&
    !Number.isNaN(Date.parse(sp.asOf + "T00:00:00Z")) &&
    new Date(sp.asOf + "T00:00:00Z").toISOString().slice(0, 10) === sp.asOf
      ? sp.asOf : DEMO_TODAY;
  const result = await getClientActivity(await getDb(), id, asOf, pageNumber);
  if (!result) notFound();
  const base = "/clients/" + encodeURIComponent(id);
  const href = (page: number) =>
    base + "/activity?asOf=" + asOf + "&page=" + page;

  return (
    <>
      <Link
        href={base}
        className="text-primary text-sm underline-offset-4 hover:underline"
      >
        ← Relationship dossier
      </Link>
      <PageHeader
        title="Client activity"
        description={"Synthetic provenance timeline · as of " + businessDate(asOf)}
      />
      <div className="border-border bg-card rounded-sm border p-5">
        <h2 className="text-sm font-semibold">Event history and limitations</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Shows submissions, historical synthetic funding, incidents, decisions,
          incident status actions and credit-case events from this client only.
          Entries link to the corresponding demonstration evidence. Missing
          events may reflect incomplete demo input, not real-world inactivity.
          This is not an immutable provider transaction log.
        </p>
        <form className="mt-4 flex flex-wrap items-end gap-2" action={base + "/activity"}>
          <div>
            <label htmlFor="activity-asof" className="text-muted-foreground block text-xs">
              Business as of
            </label>
            <input
              id="activity-asof"
              name="asOf"
              type="date"
              max={DEMO_TODAY}
              defaultValue={asOf}
              className="bg-background mt-1 rounded-sm border px-3 py-2 text-sm"
            />
          </div>
          <button className="bg-primary text-primary-foreground rounded-sm px-4 py-2 text-sm">
            View date
          </button>
        </form>
      </div>
      <section aria-labelledby="activity-heading">
        <h2 id="activity-heading" className="text-base font-semibold">
          Dated activity
        </h2>
        <p className="text-muted-foreground my-2 text-xs">
          {result.total} matching entries · Page {result.page} of{" "}
          {Math.max(1, result.totalPages)}
        </p>
        <ol className="border-border bg-card divide-border divide-y rounded-sm border">
          {result.items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="hover:bg-accent/50 focus-visible:ring-ring grid gap-1 px-5 py-4 focus-visible:ring-2 sm:grid-cols-[9rem_1fr]"
              >
                <span className="text-muted-foreground text-xs">
                  {businessDate(item.businessDate)}
                </span>
                <span>
                  <strong className="block text-sm">{item.title}</strong>
                  <span className="text-muted-foreground block text-xs">{item.detail}</span>
                  <span className="text-muted-foreground mt-1 block break-all text-xs">
                    Source: {item.sourceId} · {item.kind.replaceAll("_", " ")}
                  </span>
                </span>
              </Link>
            </li>
          ))}
          {result.items.length === 0 && (
            <li className="text-muted-foreground p-6 text-sm">
              No matching events for this page and date. This is not evidence
              of a verified zero-activity account.
            </li>
          )}
        </ol>
        <nav aria-label="Activity pages" className="mt-4 flex flex-wrap gap-3 text-sm">
          {result.page > 1 && (
            <Link className="text-primary rounded-sm border px-4 py-2" href={href(result.page - 1)}>
              ← Previous
            </Link>
          )}
          {result.page < result.totalPages && (
            <Link className="text-primary rounded-sm border px-4 py-2" href={href(result.page + 1)}>
              Next →
            </Link>
          )}
        </nav>
      </section>
      <p className="text-muted-foreground border-t pt-4 text-xs">
        Dated records use business-day cutoffs, and UTC action timestamps are
        converted to Pacific/Auckland calendar dates. Historical facility
        terms and first-observed source knowledge are not versioned here, so
        this should not be used as a bank-grade retrospective proof.
      </p>
    </>
  );
}
