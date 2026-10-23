import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { Chip, DecisionChip, SeverityChip } from "@/components/chips";
import { Loading, PageHeader, Section } from "@/components/page";
import { TrustTabs } from "@/components/trust-tabs";
import { checkLabel } from "@/lib/checks/labels";
import { businessDate, instant, money } from "@/lib/format";
import { changesSince, loadReplay } from "@/lib/queries/trust";

export const metadata = { title: "Replay" };

export default function ReplayPage({
  params,
}: PageProps<"/trust/replay/[id]">) {
  return (
    <>
      <PageHeader
        title="Decision replay"
        description="Rendered only from the snapshot stored with the decision. Live data is used only for the changes listed at the end."
      />
      <TrustTabs current="/trust/replay" />
      <Suspense fallback={<Loading label="Loading snapshot..." />}>
        <Replay params={params} />
      </Suspense>
    </>
  );
}

async function Replay({
  params,
}: {
  params: PageProps<"/trust/replay/[id]">["params"];
}) {
  await connection();
  const { id } = await params;
  const data = await loadReplay(id);
  if (!data) notFound();
  const { snap, verification, frozen } = data;
  const ctx = frozen.checkContext;
  const changes = await changesSince(frozen);
  const ok = verification.checksumMatches && verification.chainMatches;

  return (
    <>
      <div
        className={`rounded-md border px-4 py-3 text-sm ${ok ? "bg-status-clear-bg text-status-clear" : "bg-status-high-bg text-status-high"}`}
      >
        <p className="font-medium">
          {ok ? "Checksum matches" : "Checksum does not match"}
        </p>
        <p className="mt-1 break-all">
          SHA-256 {snap.sha256}
          {snap.prevSha256
            ? `, chained to ${snap.prevSha256.slice(0, 16)}...`
            : ", first in the chain"}
        </p>
        <p className="mt-1 text-xs opacity-80">
          The checksum detects accidental or casual changes to this record. It
          does not stop someone with full database access; production would
          anchor hashes outside the database.
        </p>
      </div>

      <Section title="The decision">
        <p className="text-sm">
          <DecisionChip decision={frozen.decision.decision} /> by{" "}
          {frozen.decision.analystDisplayName},{" "}
          {instant(new Date(frozen.decision.decidedAt))},{" "}
          {frozen.decision.mode === "SHADOW" ? "shadow mode" : "assist mode"}
          {frozen.decision.aiContentExposedBeforeDecision
            ? ", after seeing the agent's view"
            : ", without seeing the agent's view"}
          .{" "}
          {frozen.decision.simulated ? (
            <Chip tone="neutral">Simulated</Chip>
          ) : null}
        </p>
        {frozen.decision.reason ? (
          <p className="text-muted-foreground text-sm">
            &ldquo;{frozen.decision.reason}&rdquo;
          </p>
        ) : null}
      </Section>

      <Section title="The invoice as it was">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-muted-foreground">Invoice</dt>
          <dd>{ctx.invoice.invoiceNumber}</dd>
          <dt className="text-muted-foreground">Amount</dt>
          <dd className="num">{money(ctx.invoice.amountCents)}</dd>
          <dt className="text-muted-foreground">Issued</dt>
          <dd>{businessDate(ctx.invoice.issueDate)}</dd>
          <dt className="text-muted-foreground">Submitted</dt>
          <dd>{businessDate(ctx.submittedDate)}</dd>
          <dt className="text-muted-foreground">Ledger</dt>
          <dd>
            {ctx.ledgerEntry
              ? `${money(ctx.ledgerEntry.amountCents)}, ${ctx.ledgerEntry.status?.toLowerCase() ?? "no status"}`
              : "No ledger entry"}
          </dd>
          <dt className="text-muted-foreground">Credit notes</dt>
          <dd>
            {ctx.ledgerEntry?.creditNotes.length
              ? ctx.ledgerEntry.creditNotes
                  .map((c) => money(c.amountCents))
                  .join(", ")
              : "None"}
          </dd>
          <dt className="text-muted-foreground">Receipts before submission</dt>
          <dd className="num">
            {money(
              ctx.receiptAllocations.reduce((s, a) => s + a.amountCents, 0),
            )}
          </dd>
          <dt className="text-muted-foreground">Config</dt>
          <dd>{frozen.configVersion}</dd>
        </dl>
      </Section>

      <Section title="Checks that fired">
        {frozen.findings.length === 0 ? (
          <p className="text-muted-foreground text-sm">None.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {frozen.findings.map((f) => (
              <li key={f.id} className="flex items-center gap-2">
                <SeverityChip severity={f.severity} /> {checkLabel(f.checkId)}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="The agent's view at the time">
        {frozen.explanation ? (
          <div className="flex flex-col gap-2 text-sm">
            <p>{frozen.explanation.explanation.summary}</p>
            <ul className="text-muted-foreground list-disc pl-5">
              {frozen.explanation.explanation.claims.map((c, i) => (
                <li key={i}>
                  {c.text}{" "}
                  <span className="text-xs">({c.evidenceIds.join(", ")})</span>
                </li>
              ))}
            </ul>
            <p>
              Suggested{" "}
              <DecisionChip
                decision={frozen.explanation.explanation.recommendation}
              />
              , {frozen.explanation.run.model}, prompt{" "}
              {frozen.explanation.run.promptVersion}.
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No validated explanation was attached to this decision.
          </p>
        )}
      </Section>

      <Section
        title="What changed since"
        description="Compared with live data now."
      >
        {changes.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing relevant has changed since this decision.
          </p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
