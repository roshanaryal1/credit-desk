import {
  DecisionChip,
  RecommendationChip,
  SeverityChip,
  StatusChip,
} from "@/components/chips";
import { DecisionForm } from "@/components/decision-form";
import { ModeSwitch } from "@/components/mode-switch";
import { RerunButton } from "@/components/rerun-button";
import { checkLabel } from "@/lib/checks/labels";
import { businessDate, instant, money } from "@/lib/format";
import { getInvoiceReview } from "@/lib/queries/invoice";
import { currentAnalyst } from "@/lib/session";
import { canPerformDemoWrite } from "@/lib/demo-session";

const statusOf = (severities: string[]) =>
  severities.includes("HIGH")
    ? "HIGH_RISK"
    : severities.length > 0
      ? "FLAGGED"
      : "CLEAR";

const AGREEMENT_MAP: Record<string, string> = {
  APPROVE: "APPROVE",
  HOLD: "HOLD",
  REJECT: "REJECT",
  REQUEST_INFO: "HOLD",
};

export async function InvoicePanel({
  invoiceId,
  batchId,
}: {
  invoiceId: string;
  batchId: string;
}) {
  const analyst = await currentAnalyst();
  const readOnly = !(await canPerformDemoWrite());
  const data = await getInvoiceReview(invoiceId, analyst, batchId, readOnly);
  if (!data) {
    return (
      <aside className="rounded-md border p-4 text-sm">
        That invoice is not in this batch.
      </aside>
    );
  }
  const { invoice, debtor, findings, decisions, explanation, evidence } = data;
  const first = decisions[0];
  const latest = decisions.at(-1);
  const exp = explanation?.explanation;
  const footnote = new Map<string, number>();
  for (const id of exp?.claims.flatMap((c) => c.evidenceIds) ?? []) {
    if (!footnote.has(id)) footnote.set(id, footnote.size + 1);
  }

  return (
    <aside
      aria-label={`Invoice ${invoice.invoiceNumber}`}
      className="bg-card flex flex-col gap-5 rounded-md border p-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto"
    >
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{invoice.invoiceNumber}</h2>
          <StatusChip status={statusOf(findings.map((f) => f.severity))} />
        </div>
        <p className="text-muted-foreground text-sm">{debtor.name}</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Amount</dt>
          <dd className="num text-right font-medium">
            {money(invoice.amountCents)}
          </dd>
          <dt className="text-muted-foreground">Issued</dt>
          <dd className="text-right">{businessDate(invoice.issueDate)}</dd>
          <dt className="text-muted-foreground">Due</dt>
          <dd className="text-right">{businessDate(invoice.dueDate)}</dd>
        </dl>
      </header>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Checks that fired</h3>
        {findings.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No checks fired. The invoice matches the ledger and the bank record.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {findings.map((f) => (
              <li key={f.id} className="flex flex-col gap-1 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span>{checkLabel(f.checkId)}</span>
                  <SeverityChip severity={f.severity} />
                </div>
                <FindingDetails
                  details={f.details as Record<string, unknown>}
                  evidence={evidence}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {findings.length > 0 ? (
        <section className="flex flex-col gap-2 border-t pt-4">
          <h3 className="text-sm font-semibold">Agent explanation</h3>
          {data.withheld ? (
            <p className="bg-muted rounded-md px-3 py-2 text-sm">
              Shadow mode: decide first. The agent&apos;s explanation and
              recommendation appear once a decision is saved, so they do not
              shape it.
            </p>
          ) : !data.hasExplanation ? (
            <p className="text-muted-foreground text-sm">
              No explanation has been generated for this invoice yet. The raw
              findings above are complete.
            </p>
          ) : exp && exp.validationStatus === "PASSED" ? (
            <>
              <p className="text-sm">{exp.summary}</p>
              <ol className="flex flex-col gap-1.5 text-sm">
                {exp.claims.map((c, i) => (
                  <li key={i}>
                    {c.text}
                    {c.evidenceIds.map((id) => (
                      <a
                        key={id}
                        href={`#ev-${id}`}
                        className="text-primary ml-0.5 align-super text-[0.7em] underline-offset-2 hover:underline"
                        aria-label={`Evidence ${footnote.get(id)}: ${id}`}
                      >
                        {footnote.get(id)}
                      </a>
                    ))}
                  </li>
                ))}
              </ol>
              <ol className="text-muted-foreground flex flex-col gap-1 border-t pt-2 text-xs">
                {[...footnote.entries()].map(([id, n]) => {
                  const ev = data.agentEvidence.get(id);
                  return (
                    <li key={id} id={`ev-${id}`} className="scroll-mt-4">
                      <span className="text-foreground">{n}.</span>{" "}
                      {ev ? `${ev.kind}: ${ev.facts.join(", ")}` : id}{" "}
                      <span className="text-muted-foreground">({id})</span>
                    </li>
                  );
                })}
              </ol>
              {exp.questionsForClient.length > 0 ? (
                <div className="text-sm">
                  <p className="font-medium">Questions for the client</p>
                  <ul className="text-muted-foreground list-disc pl-5">
                    {exp.questionsForClient.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-sm">
                Agent suggests{" "}
                <RecommendationChip recommendation={exp.recommendation} />{" "}
                <span className="text-muted-foreground">
                  (risk {exp.riskLevel.toLowerCase()})
                </span>
              </p>
              {first &&
              first.mode === "SHADOW" &&
              !first.aiContentExposedBeforeDecision &&
              data.boundExplanation?.validationStatus === "PASSED" ? (
                <p className="text-muted-foreground text-sm">
                  {AGREEMENT_MAP[data.boundExplanation.recommendation] ===
                  first.decision
                    ? "The first decision agreed with the agent."
                    : "The first decision differed from the agent."}
                </p>
              ) : null}
              <p className="text-muted-foreground text-xs">
                {explanation!.run.model}, prompt{" "}
                {explanation!.run.promptVersion}.{" "}
                {data.agentEvidenceSource === "CAPTURED"
                  ? "Original tool evidence is preserved."
                  : "Legacy evidence is reconstructed from dated current records, not an original tool transcript."}{" "}
                Citations and figures were checked against these records; the
                reasoning is the agent&apos;s and was not checked.
              </p>
            </>
          ) : (
            <p className="text-sm">
              Explanation unavailable, see the raw findings.
            </p>
          )}
          {!readOnly && !data.withheld ? (
            <RerunButton invoiceId={invoice.id} />
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-3 border-t pt-4">
        {latest ? (
          <div className="flex flex-col gap-1 text-sm">
            <p>
              Current decision <DecisionChip decision={latest.decision} /> by{" "}
              {latest.analystDisplayName}
              {latest.simulated ? " (simulated history)" : ""},{" "}
              {instant(latest.decidedAt)}.
            </p>
            {latest.reason ? (
              <p className="text-muted-foreground">
                &ldquo;{latest.reason}&rdquo;
              </p>
            ) : null}
            <a
              href={`/trust/replay/${latest.id}`}
              className="text-primary self-start underline underline-offset-4"
            >
              Replay this decision
            </a>
          </div>
        ) : null}
        {readOnly ? (
          <p className="bg-muted text-muted-foreground rounded-sm p-3 text-sm">
            Read-only demo perspective. Only a fictional credit analyst can
            exercise synthetic decisions; this view cannot approve funding.
          </p>
        ) : (
          <>
            <ModeSwitch mode={analyst.mode} />
            <DecisionForm
              key={data.reviewVersion}
              invoiceId={invoice.id}
              reviewVersion={data.reviewVersion}
              hasHighRiskFindings={findings.some((f) => f.severity === "HIGH")}
            />
          </>
        )}
        {latest ? (
          <p className="text-muted-foreground text-xs">
            A new decision is a revision. Every decision stays in the audit log.
          </p>
        ) : null}
      </section>
    </aside>
  );
}

const DETAIL_LABELS: Record<string, string> = {
  allocatedCents: "Received before submission",
  amountCents: "Invoice amount",
  creditedCents: "Credited",
  debtorCents: "This debtor",
  totalCents: "Book plus batch",
  shareBps: "Share",
  daysKnown: "Days since first seen",
  ageDays: "Age at submission (days)",
  meanDaysToPay: "Average days to pay",
  paymentCount: "Payments counted",
  thresholdDays: "Threshold (days)",
  issueDate: "Issued",
  submittedDate: "Submitted",
  firstSeenDate: "First seen",
  status: "Ledger status",
  hasPaymentHistory: "Has payment history",
};

function formatDetail(key: string, value: unknown): string {
  if (typeof value === "number" && /cents$/i.test(key)) return money(value);
  if (key === "shareBps" && typeof value === "number")
    return `${(value / 100).toFixed(1)}%`;
  if (key === "meanDaysToPay" && typeof value === "number")
    return value.toFixed(0);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
    return businessDate(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/** Deterministic finding details and their evidence, shown in every mode. */
function FindingDetails({
  details,
  evidence,
}: {
  details: Record<string, unknown>;
  evidence: Map<string, { id: string; kind: string; facts: string[] }>;
}) {
  const differences = details.differences as
    Record<string, { submitted: unknown; ledger: unknown }> | undefined;
  const rows = Object.entries(details).filter(([k]) => DETAIL_LABELS[k]);
  const ids = ((details.evidenceIds as string[] | undefined) ?? [])
    .filter((id) => evidence.has(id))
    .slice(0, 6);
  return (
    <div className="text-muted-foreground flex flex-col gap-0.5 pl-2 text-xs">
      {differences
        ? Object.entries(differences).map(([field, d]) => (
            <span key={field}>
              {field === "amountCents"
                ? "Amount"
                : field === "issueDate"
                  ? "Issue date"
                  : "Debtor"}
              : submitted {formatDetail(field, d.submitted)}, ledger{" "}
              {formatDetail(field, d.ledger)}
            </span>
          ))
        : null}
      {rows.map(([k, v]) => (
        <span key={k}>
          {DETAIL_LABELS[k]}: {formatDetail(k, v)}
        </span>
      ))}
      {ids.map((id) => {
        const ev = evidence.get(id)!;
        return (
          <span key={id}>
            {ev.kind}: {ev.facts.join(", ")} ({id})
          </span>
        );
      })}
    </div>
  );
}
