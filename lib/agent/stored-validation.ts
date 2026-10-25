import { and, eq, inArray, or } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

import { EvidenceRegistry } from "./evidence";
import { ToolExecutor } from "./tools";
import { validateOutput } from "./validator";
import { verifyCapturedRunEvidence } from "./manifest";

export interface StoredExplanation {
  explanation: typeof t.explanations.$inferSelect;
  run: typeof t.agentRuns.$inferSelect;
}

function validDay(value: string): boolean {
  const millis = Date.parse(`${value}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(millis) &&
    new Date(millis).toISOString().slice(0, 10) === value
  );
}

/**
 * Recheck old PASSED output without modifying its immutable history. The
 * original per-run transcript is not retained: reconstruction can only
 * corroborate originally cited IDs via today's scoped, dated read-only tools.
 * It never rehabilitates a historically failed run or explanation.
 */
export async function storedExplanationUsable(
  db: Pick<Db, "select">,
  stored: StoredExplanation,
  visibleAsOf?: string,
): Promise<boolean> {
  const { explanation, run } = stored;
  if (explanation.validationStatus !== "PASSED" || run.status !== "PASSED")
    return false;
  const captured = await verifyCapturedRunEvidence(db, stored);
  if (captured !== "LEGACY") {
    // A cryptographically valid original transcript must still not leak an
    // explanation to a historical screen before its review business date.
    if (captured !== "PASSED") return false;
    if (visibleAsOf !== undefined) {
      if (!validDay(visibleAsOf) || !run.asOfDate || !validDay(run.asOfDate)) {
        return false;
      }
      if (run.asOfDate > visibleAsOf) return false;
    }
    return true;
  }
  try {
    const [invoice] =
      run.subjectType === "INVOICE"
        ? await db
            .select({
              clientId: t.invoices.clientId,
              asOf: t.batches.submittedDate,
            })
            .from(t.invoices)
            .innerJoin(t.batches, eq(t.invoices.batchId, t.batches.id))
            .where(eq(t.invoices.id, run.subjectId))
            .limit(1)
        : [];
    const [incident] =
      run.subjectType === "INCIDENT"
        ? await db
            .select()
            .from(t.incidents)
            .where(eq(t.incidents.id, run.subjectId))
            .limit(1)
        : [];
    const clientId = invoice?.clientId ?? incident?.clientId;
    const asOf = run.asOfDate ?? invoice?.asOf;
    if (
      !clientId ||
      !asOf ||
      !validDay(asOf) ||
      (invoice && asOf !== invoice.asOf) ||
      (incident && asOf < incident.firstDetectedDate) ||
      (visibleAsOf !== undefined &&
        (!validDay(visibleAsOf) || asOf > visibleAsOf))
    )
      return false;

    const ids = [
      ...new Set([
        ...explanation.citedEvidenceIds,
        ...explanation.claims.flatMap((c) => c.evidenceIds),
      ]),
    ];
    if (!ids.length) return false;
    const tools = new ToolExecutor(db, { clientId, asOf });
    // These lookups identify which tools can retrieve a cited ID. Raw rows are
    // never admitted as evidence; each record must survive the tool's scope.
    const [ledgers, notes, findings, fundings, adjustments, payments, banks] =
      await Promise.all([
        db
          .select({ invoiceNumber: t.ledgerEntries.invoiceNumber })
          .from(t.ledgerEntries)
          .where(
            and(
              eq(t.ledgerEntries.clientId, clientId),
              inArray(t.ledgerEntries.id, ids),
            ),
          ),
        db
          .select({ invoiceNumber: t.ledgerEntries.invoiceNumber })
          .from(t.creditNotes)
          .innerJoin(
            t.ledgerEntries,
            eq(t.creditNotes.ledgerEntryId, t.ledgerEntries.id),
          )
          .where(
            and(
              eq(t.ledgerEntries.clientId, clientId),
              inArray(t.creditNotes.id, ids),
            ),
          ),
        db
          .select({ invoiceId: t.findings.invoiceId })
          .from(t.findings)
          .innerJoin(t.invoices, eq(t.findings.invoiceId, t.invoices.id))
          .where(
            and(eq(t.invoices.clientId, clientId), inArray(t.findings.id, ids)),
          ),
        db
          .select({ invoiceId: t.fundings.invoiceId })
          .from(t.fundings)
          .innerJoin(t.invoices, eq(t.fundings.invoiceId, t.invoices.id))
          .where(
            and(eq(t.invoices.clientId, clientId), inArray(t.fundings.id, ids)),
          ),
        db
          .select({ invoiceId: t.fundings.invoiceId })
          .from(t.fundingAdjustments)
          .innerJoin(
            t.fundings,
            eq(t.fundingAdjustments.fundingId, t.fundings.id),
          )
          .innerJoin(t.invoices, eq(t.fundings.invoiceId, t.invoices.id))
          .where(
            and(
              eq(t.invoices.clientId, clientId),
              inArray(t.fundingAdjustments.id, ids),
            ),
          ),
        db
          .select({ debtorId: t.debtorPayments.debtorId })
          .from(t.debtorPayments)
          .innerJoin(t.debtors, eq(t.debtorPayments.debtorId, t.debtors.id))
          .where(
            and(
              eq(t.debtors.clientId, clientId),
              inArray(t.debtorPayments.id, ids),
            ),
          ),
        db
          .select()
          .from(t.bankTransactions)
          .where(
            and(
              eq(t.bankTransactions.clientId, clientId),
              inArray(t.bankTransactions.id, ids),
            ),
          ),
      ]);
    const invoiceNumbers = [
      ...new Set([...ledgers, ...notes].map((l) => l.invoiceNumber)),
    ];
    const invoices = await db
      .select({ id: t.invoices.id, invoiceNumber: t.invoices.invoiceNumber })
      .from(t.invoices)
      .where(
        and(
          eq(t.invoices.clientId, clientId),
          or(
            inArray(t.invoices.id, ids),
            inArray(t.invoices.invoiceNumber, invoiceNumbers),
          ),
        ),
      );
    for (const invoice of invoices) {
      if (ids.includes(invoice.id)) await tools.getInvoice(invoice.id);
      if (invoiceNumbers.includes(invoice.invoiceNumber))
        await tools.getLedgerEntry(invoice.id);
    }
    for (const id of new Set(findings.map((f) => f.invoiceId)))
      await tools.getFindings(id);
    for (const id of new Set(
      [...fundings, ...adjustments].map((f) => f.invoiceId),
    ))
      await tools.getFunding(id);
    const allocations = banks.length
      ? await db
          .select({
            bankId: t.receiptAllocations.bankTransactionId,
            debtorId: t.ledgerEntries.debtorId,
          })
          .from(t.receiptAllocations)
          .innerJoin(
            t.ledgerEntries,
            eq(t.receiptAllocations.ledgerEntryId, t.ledgerEntries.id),
          )
          .where(
            and(
              eq(t.ledgerEntries.clientId, clientId),
              inArray(
                t.receiptAllocations.bankTransactionId,
                banks.map((b) => b.id),
              ),
            ),
          )
      : [];
    const debtors = await db
      .select({ id: t.debtors.id, name: t.debtors.name })
      .from(t.debtors)
      .where(
        and(
          eq(t.debtors.clientId, clientId),
          or(
            inArray(t.debtors.id, [
              ...ids,
              ...payments.map((p) => p.debtorId),
              ...allocations.map((a) => a.debtorId),
            ]),
            inArray(
              t.debtors.name,
              banks.map((b) => b.counterpartyName),
            ),
          ),
        ),
      );
    for (const debtor of debtors.filter(
      (d) => ids.includes(d.id) || payments.some((p) => p.debtorId === d.id),
    ))
      await tools.getDebtorHistory(debtor.id);
    for (const bank of banks)
      for (const debtor of debtors.filter(
        (d) =>
          d.name === bank.counterpartyName ||
          allocations.some((a) => a.bankId === bank.id && a.debtorId === d.id),
      ))
        await tools.getBankTransactions(debtor.id, bank.date, bank.date);
    const incidents = await db
      .select({ id: t.incidents.id })
      .from(t.incidents)
      .where(
        and(eq(t.incidents.clientId, clientId), inArray(t.incidents.id, ids)),
      );
    for (const incident of incidents) await tools.getIncident(incident.id);

    const cited = new EvidenceRegistry(clientId);
    for (const id of ids) {
      const record = tools.evidence.get(id);
      if (!record) return false;
      cited.add(record);
    }
    return validateOutput(
      JSON.stringify({
        summary: explanation.summary,
        risk_level: explanation.riskLevel.toLowerCase(),
        recommendation: explanation.recommendation,
        questions_for_client: explanation.questionsForClient,
        claims: explanation.claims.map((c) => ({
          text: c.text,
          evidence_ids: c.evidenceIds,
        })),
        cited_evidence_ids: explanation.citedEvidenceIds,
      }),
      cited,
    ).ok;
  } catch {
    return false;
  }
}
