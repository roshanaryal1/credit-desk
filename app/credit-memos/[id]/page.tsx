import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { PageHeader, Loading } from "@/components/page";
import { draftMemoFromSyntheticClient } from "@/lib/credit/memo-demo";
import { clientEvidenceRequirements } from "@/lib/credit/evidence-checklist";
import { getDb } from "@/lib/db/client";
import { DEMO_TODAY } from "@/lib/demo";
import { businessDate } from "@/lib/format";
import { listClients } from "@/lib/queries/book";

export default function CreditMemoDetail({
  params,
}: PageProps<"/credit-memos/[id]">) {
  return (
    <Suspense
      fallback={<Loading label="Preparing evidence-bounded draft..." />}
    >
      <MemoReview params={params} />
    </Suspense>
  );
}

async function MemoReview({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const client = (await listClients()).find((c) => c.id === id);
  if (!client) notFound();
  const memo = draftMemoFromSyntheticClient(client);
  const checklist = await clientEvidenceRequirements(
    await getDb(),
    id,
    DEMO_TODAY,
  );
  return (
    <div className="space-y-7">
      <div>
        <Link
          href="/credit-memos"
          className="text-primary text-sm underline-offset-4 hover:underline"
        >
          ← Credit assessment drafts
        </Link>
      </div>
      <div className="flex flex-wrap gap-2 print:hidden">
        <a
          href={`/credit-memos/${encodeURIComponent(id)}/export`}
          download
          className="border-border bg-card hover:bg-accent/50 focus-visible:ring-ring inline-flex items-center rounded-sm border px-4 py-2 text-sm font-semibold focus-visible:ring-2"
        >
          Download evidence-bound draft (.md) →
        </a>
        <p className="text-muted-foreground self-center text-xs">
          Synthetic, unsigned, with mandatory missing-evidence checklist.
        </p>
      </div>
      <PageHeader
        title="Credit assessment"
        description="Source-backed draft · Analyst verification required before any recommendation"
      />
      <article
        aria-label={memo.title}
        className="border-border bg-card mx-auto w-full max-w-4xl rounded-sm border px-5 py-7 shadow-sm sm:px-10 sm:py-9"
      >
        <header className="border-border border-b pb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-primary text-[11px] font-semibold tracking-[0.16em] uppercase">
                Credit Desk / Credit memorandum
              </p>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight">
                {client.name}
              </h2>
              <p className="text-muted-foreground mt-2 text-xs">
                Business date: {businessDate(memo.asOfDate)} · NZD
              </p>
            </div>
            <div className="border-status-flagged bg-status-flagged-bg text-status-flagged rounded-sm border px-3 py-2 text-xs font-semibold">
              DRAFT — NOT APPROVED
            </div>
          </div>
        </header>

        <div className="divide-border divide-y">
          {memo.sections.map((section, index) => (
            <section className="py-6" key={section.title}>
              <p className="text-primary mb-2 text-[10px] font-semibold tracking-widest uppercase">
                {String(index + 1).padStart(2, "0")} / Review
              </p>
              <h3 className="text-base font-semibold">{section.title}</h3>
              <ul className="mt-4 space-y-3">
                {section.statements.map((statement) => (
                  <li className="text-sm leading-relaxed" key={statement.text}>
                    {statement.text}
                    {statement.evidenceIds.length > 0 && (
                      <span className="text-muted-foreground ml-2 text-xs">
                        [{statement.evidenceIds.join(", ")}]
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section
          aria-labelledby="missing-heading"
          className="border-border bg-muted/40 rounded-sm border p-5"
        >
          <h3 id="missing-heading" className="text-sm font-semibold">
            Required evidence before an analyst recommendation
          </h3>
          <ul className="text-muted-foreground mt-3 list-inside list-disc space-y-2 text-sm">
            {memo.missingItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="checklist-heading" className="mt-7">
          <h3 id="checklist-heading" className="text-sm font-semibold">
            Structured fictional case evidence
          </h3>
          <p className="text-muted-foreground mt-2 text-xs">
            Case-linked metadata only. No real documents or authenticated
            checker sign-off.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {checklist.map((item) => (
              <li className="border-border rounded-sm border p-3" key={item.id}>
                <strong>{item.label}</strong>
                <span className="text-muted-foreground block text-xs">
                  {item.state} · {item.dueState} · due{" "}
                  {item.dueDate ? businessDate(item.dueDate) : "not set"}
                  {" · "}
                  {item.id}
                </span>
              </li>
            ))}
            {checklist.length === 0 && (
              <li className="text-muted-foreground">
                No case-linked synthetic requirements recorded. This does not
                certify completeness.
              </li>
            )}
          </ul>
        </section>
        <section aria-labelledby="sources-heading" className="mt-7">
          <h3 id="sources-heading" className="text-sm font-semibold">
            Evidence register
          </h3>
          <div
            role="region"
            aria-labelledby="sources-heading"
            tabIndex={0}
            className="border-border focus-visible:ring-ring mt-3 overflow-x-auto rounded-sm border focus-visible:ring-2 focus-visible:outline-none"
          >
            <table className="w-full min-w-[420px] text-left text-xs">
              <caption className="sr-only">
                Evidence IDs and data sources supporting draft financial
                statements
              </caption>
              <thead className="bg-muted/40 text-muted-foreground border-b">
                <tr>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Reference
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Source
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    As of
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {memo.evidenceIndex.map((item) => (
                  <tr key={item.id}>
                    <th scope="row" className="px-3 py-3 font-medium">
                      {item.id}
                    </th>
                    <td className="px-3 py-3">{item.sourceLabel}</td>
                    <td className="num px-3 py-3">
                      {businessDate(item.asOfDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <footer className="border-border text-muted-foreground mt-8 border-t pt-5 text-xs leading-relaxed">
          Synthetic-data demonstration, version {memo.version}. No verified bank
          feed, external credit approval, legal commitment, lender sign-off, or
          permission to release funds is implied. Signed off by: none.
        </footer>
      </article>
    </div>
  );
}
