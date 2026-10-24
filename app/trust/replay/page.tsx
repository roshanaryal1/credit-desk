import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Chip, DecisionChip } from "@/components/chips";
import { Loading, PageHeader } from "@/components/page";
import { TrustTabs } from "@/components/trust-tabs";
import { instant } from "@/lib/format";
import { decisionRecords } from "@/lib/queries/trust";

export const metadata = { title: "Replay" };

export default function ReplayListPage() {
  return (
    <>
      <PageHeader
        title="Trust Panel"
        description="Reopen any decision exactly as it was made, from its frozen snapshot."
      />
      <TrustTabs current="/trust/replay" />
      <Suspense fallback={<Loading label="Loading decisions..." />}>
        <ReplayList />
      </Suspense>
    </>
  );
}

async function ReplayList() {
  await connection();
  const records = (await decisionRecords()).reverse().slice(0, 100);
  if (records.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No decisions yet. Decide on an invoice and its snapshot appears here.
      </p>
    );
  }
  return (
    <ul className="bg-card divide-y rounded-md border text-sm">
      {records.map((r) => (
        <li
          key={r.decisionId}
          className="flex flex-wrap items-center gap-2 px-4 py-2.5"
        >
          <Link
            href={`/trust/replay/${r.decisionId}`}
            className="text-primary font-medium underline underline-offset-4"
          >
            {r.invoiceId}
          </Link>
          <DecisionChip decision={r.decision} />
          <span className="text-muted-foreground">
            {instant(new Date(r.decidedAt))}
          </span>
          {r.simulated ? <Chip tone="neutral">Simulated</Chip> : null}
          {r.mode === "ASSIST" ? <Chip tone="info">Assist mode</Chip> : null}
        </li>
      ))}
    </ul>
  );
}
