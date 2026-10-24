import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { PageHeader, Loading } from "@/components/page";
import { money } from "@/lib/format";
import { listClients } from "@/lib/queries/book";

export const metadata = { title: "Credit assessment drafts" };

export default function CreditMemosPage() {
  return (
    <>
      <PageHeader
        title="Credit assessment drafts"
        description="Review verifiable synthetic facility facts before preparing a formal credit recommendation."
      />
      <Suspense
        fallback={<Loading label="Loading synthetic relationships..." />}
      >
        <DraftDirectory />
      </Suspense>
    </>
  );
}

async function DraftDirectory() {
  await connection();
  const clients = await listClients();
  return (
    <div className="space-y-5">
      <div className="border-border bg-card rounded-sm border p-5">
        <p className="text-primary text-xs font-semibold tracking-wide uppercase">
          Draft preparation / Assurance
        </p>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          These records are demonstration-only. Drafts contain only
          source-linked amounts. Missing underwriting facts are left incomplete
          instead of generated, and no memo is approved or sent from this
          screen.
        </p>
      </div>
      <section aria-label="Synthetic clients with draft memo previews">
        <ul className="border-border bg-card divide-border divide-y rounded-sm border">
          {clients.map((client) => (
            <li key={client.id}>
              <Link
                href={`/credit-memos/${encodeURIComponent(client.id)}`}
                className="hover:bg-accent/50 focus-visible:ring-ring flex flex-wrap items-center justify-between gap-3 px-5 py-4 focus-visible:ring-2 focus-visible:outline-none"
              >
                <span>
                  <span className="block text-sm font-semibold">
                    {client.name}
                  </span>
                  <span className="text-muted-foreground mt-1 block text-xs">
                    Synthetic facility · Analyst review required
                  </span>
                </span>
                <span className="text-right">
                  <span className="num block text-sm font-semibold">
                    {money(client.facilityLimitCents)}
                  </span>
                  <span className="text-primary mt-1 block text-xs font-medium">
                    Open draft →
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {clients.length === 0 && (
          <p className="text-muted-foreground border-border rounded-sm border p-8 text-sm">
            No seeded client records are available.
          </p>
        )}
      </section>
    </div>
  );
}
