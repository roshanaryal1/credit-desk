import { connection } from "next/server";
import { Suspense } from "react";

import { Loading, PageHeader } from "@/components/page";
import { DEMO_TODAY } from "@/lib/demo";
import { clientEvidenceRequirements } from "@/lib/credit/evidence-checklist";
import { DEMO_CLIENT_ID } from "@/lib/demo-personas";
import { getDb } from "@/lib/db/client";
import { businessDate, money } from "@/lib/format";
import { getClientDossier } from "@/lib/queries/client-360";
import { getClientReceivablesAgeing } from "@/lib/queries/client-ageing";
import { currentDemoPersona } from "@/lib/demo-session";
import { notFound } from "next/navigation";

export const metadata = { title: "Borrower demo" };

export default function ClientDemoPage() {
  return (
    <Suspense fallback={<Loading label="Loading synthetic borrower view..." />}>
      <BorrowerView />
    </Suspense>
  );
}

async function BorrowerView() {
  await connection();
  if ((await currentDemoPersona()) !== "CLIENT") notFound();
  const db = await getDb();
  const [dossier, ageing] = await Promise.all([
    getClientDossier(db, DEMO_CLIENT_ID, DEMO_TODAY),
    getClientReceivablesAgeing(db, DEMO_CLIENT_ID, DEMO_TODAY),
  ]);
  const checklist = (
    await clientEvidenceRequirements(db, DEMO_CLIENT_ID, DEMO_TODAY)
  ).filter((item) => item.state === "MISSING" || item.state === "EXPIRED");
  if (!dossier || !ageing) {
    return (
      <p role="status" className="text-muted-foreground">
        The fictional client has not been seeded in this environment. The demo
        does not show a fabricated zero balance.
      </p>
    );
  }
  return (
    <>
      <PageHeader
        title={dossier.client.name}
        description={
          "Client perspective · fictional relationship as of " +
          businessDate(DEMO_TODAY)
        }
      />
      <section className="border-border bg-card rounded-sm border p-6">
        <h2 className="text-base font-semibold">
          Your synthetic facility snapshot
        </h2>
        <dl className="mt-5 grid gap-5 sm:grid-cols-3">
          {[
            {
              label: "Facility commitment",
              value: money(dossier.client.facilityLimitCents),
            },
            {
              label: "Current funded exposure",
              value: money(dossier.inUseCents),
            },
            {
              label: "Undrawn commitment",
              value: money(dossier.commitmentHeadroomCents),
            },
          ].map((entry) => (
            <div key={entry.label}>
              <dt className="text-muted-foreground text-xs">{entry.label}</dt>
              <dd className="num mt-1 text-xl font-semibold">{entry.value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground mt-4 text-sm">
          Undrawn commitment is not verified availability for drawing. No
          application, disbursement or actual customer account is connected.
        </p>
      </section>
      <section className="border-border bg-card rounded-sm border p-6">
        <h2 className="text-base font-semibold">Receivables overview</h2>
        <dl className="mt-4 grid gap-5 sm:grid-cols-3">
          {[
            {
              label: "Receivables outstanding",
              value: money(ageing.totalOutstandingCents),
            },
            { label: "Overdue receivables", value: money(ageing.overdueCents) },
            { label: "Not yet overdue", value: money(ageing.currentCents) },
          ].map((entry) => (
            <div key={entry.label}>
              <dt className="text-muted-foreground text-xs">{entry.label}</dt>
              <dd className="num mt-1 text-lg font-semibold">{entry.value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground mt-4 text-xs">
          Based on synthetic ledger examples with estimated contract dates. No
          confidential records, lending decisions, staff audit logs or other
          client portfolios are shown in this role.
        </p>
      </section>
      <section className="border-border bg-card rounded-sm border p-6">
        <h2 className="text-base font-semibold">
          Outstanding fictional evidence
        </h2>
        <p className="text-muted-foreground mt-2 text-xs">
          Only the configured fictional borrower’s checklist appears here.
          Statuses are seeded metadata, not document verification or consent.
        </p>
        <ul className="mt-4 space-y-2 text-sm">
          {checklist.map((item) => (
            <li className="border-border rounded-sm border p-3" key={item.id}>
              <span className="font-semibold">{item.label}</span>
              <span className="text-muted-foreground block text-xs">
                {item.state} · {item.dueState} · Due:{" "}
                {item.dueDate ? businessDate(item.dueDate) : "not set"}
              </span>
            </li>
          ))}
          {checklist.length === 0 && (
            <li className="text-muted-foreground">
              No outstanding fictional checklist rows are available. This does
              not certify all documents as complete.
            </li>
          )}
        </ul>
      </section>
    </>
  );
}
