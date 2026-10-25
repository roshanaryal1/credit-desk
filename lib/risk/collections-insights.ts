import { debtorAgeing, type AgeingReceivable } from "./debtor-ageing";
import { daysBetween } from "@/lib/dates";

const DAY_MS = 86_400_000;

/** Invoice knowledge date, when available from the source ledger. */
export interface CollectionsReceivable extends AgeingReceivable {
  recordedDate?: string;
}

export interface CollectionsSignal {
  code: "ARREARS_INCREASE" | "PAYMENTS_SLOWED" | "RECENT_CREDIT";
  description: string;
  invoiceIds: string[];
  sourceIds: string[];
}

export interface DebtorCollectionsInsight {
  debtorId: string;
  asOf: string;
  overdueNowCents: number;
  overdue30DaysAgoCents: number;
  overdueMovement30DaysCents: number;
  receiptsLast30DaysCents: number;
  receiptsPrevious30DaysCents: number;
  creditsLast30DaysCents: number;
  cashSettledInvoiceCount: number;
  meanDaysToCashSettlement: number | null;
  /** Complete credit sales / opening AR data are not verified in this demo. */
  dsoDays: null;
  signals: CollectionsSignal[];
}

function day(date: string): number {
  return Math.floor(Date.parse(date + "T00:00:00Z") / DAY_MS);
}

function checkedSum(values: number[]): number {
  const result = values.reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error("Collections monetary total overflow");
  }
  return result;
}

/**
 * Descriptive, evidence-linked synthetic collections indicators.
 * This intentionally does not manufacture DSO from an incomplete credit-sales
 * history or treat lower collections as a predictive default risk score.
 * The ageing engine validates inputs and enforces effective-date semantics.
 */
export function collectionsInsights(
  asOf: string,
  receivables: CollectionsReceivable[],
): DebtorCollectionsInsight[] {
  daysBetween(asOf, asOf);
  for (const row of receivables) {
    if (row.recordedDate !== undefined)
      daysBetween(row.recordedDate, row.recordedDate);
  }
  const knownAt = (date: string) =>
    receivables.filter(
      (row) =>
        // Older callers supply an already reconciled snapshot without knowledge
        // metadata. The ageing engine still enforces their effective issue date.
        row.recordedDate === undefined || row.recordedDate <= date,
    );
  const visible = knownAt(asOf);
  const current = debtorAgeing(asOf, visible);
  const cutoff = day(asOf);
  const previousDate = new Date((cutoff - 30) * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const previous = new Map(
    debtorAgeing(previousDate, knownAt(previousDate)).map((d) => [
      d.debtorId,
      d,
    ]),
  );
  const rowsByDebtor = new Map<string, CollectionsReceivable[]>();
  for (const row of visible) {
    if (day(row.issuedDate) > cutoff) continue;
    const rows = rowsByDebtor.get(row.debtorId) ?? [];
    rows.push(row);
    rowsByDebtor.set(row.debtorId, rows);
  }

  return current.map((d) => {
    const rows = rowsByDebtor.get(d.debtorId) ?? [];
    const before = previous.get(d.debtorId)?.overdueCents ?? 0;
    const creditEvents = rows.flatMap((row) =>
      row.creditNotes
        .filter((credit) => {
          const age = cutoff - day(credit.effectiveDate);
          return age >= 0 && age < 30;
        })
        .map((credit) => ({
          invoiceId: row.invoiceId,
          sourceId: credit.sourceId,
          cents: credit.cents,
        })),
    );
    const creditsLast30DaysCents = checkedSum(
      creditEvents.map((credit) => credit.cents),
    );

    // Credit-only closures, partial receipts, and prepayments do not
    // constitute an observed full-cash-settlement duration.
    const settledDays: number[] = [];
    for (const row of rows) {
      const issueDay = day(row.issuedDate);
      const receipts = row.receiptAllocations.filter(
        (event) => day(event.effectiveDate) <= cutoff,
      );
      const credits = row.creditNotes.filter(
        (event) => day(event.effectiveDate) <= cutoff,
      );
      if (
        row.faceCents <= 0 ||
        checkedSum(receipts.map((r) => r.cents)) !== row.faceCents ||
        credits.length > 0 ||
        receipts.some((r) => day(r.effectiveDate) < issueDay)
      ) {
        continue;
      }
      settledDays.push(
        Math.max(...receipts.map((r) => day(r.effectiveDate))) - issueDay,
      );
    }

    const overdueMovement30DaysCents = d.overdueCents - before;
    const signals: CollectionsSignal[] = [];
    if (overdueMovement30DaysCents > 0) {
      signals.push({
        code: "ARREARS_INCREASE",
        description: "Past-due receivables increased over 30 calendar days.",
        invoiceIds: d.invoices
          .filter(
            (invoice) =>
              invoice.outstandingCents > 0 && invoice.daysPastDue > 0,
          )
          .map((invoice) => invoice.invoiceId),
        sourceIds: [],
      });
    }
    if (
      d.paymentsPrevious30DaysCents > 0 &&
      d.paymentsLast30DaysCents < d.paymentsPrevious30DaysCents
    ) {
      const receipts = rows.flatMap((row) =>
        row.receiptAllocations
          .filter((receipt) => {
            const age = cutoff - day(receipt.effectiveDate);
            return age >= 0 && age < 60;
          })
          .map((receipt) => ({
            invoiceId: row.invoiceId,
            sourceId: receipt.sourceId,
          })),
      );
      signals.push({
        code: "PAYMENTS_SLOWED",
        description:
          "Recorded receipt value is lower than in the preceding 30 days; this is not a credit-risk prediction.",
        invoiceIds: [...new Set(receipts.map((r) => r.invoiceId))].sort(),
        sourceIds: [...new Set(receipts.map((r) => r.sourceId))].sort(),
      });
    }
    if (creditsLast30DaysCents > 0) {
      signals.push({
        code: "RECENT_CREDIT",
        description:
          "Dated credit notes reduced receivables in the past 30 days.",
        invoiceIds: [...new Set(creditEvents.map((c) => c.invoiceId))].sort(),
        sourceIds: [...new Set(creditEvents.map((c) => c.sourceId))].sort(),
      });
    }
    return {
      debtorId: d.debtorId,
      asOf,
      overdueNowCents: d.overdueCents,
      overdue30DaysAgoCents: before,
      overdueMovement30DaysCents,
      receiptsLast30DaysCents: d.paymentsLast30DaysCents,
      receiptsPrevious30DaysCents: d.paymentsPrevious30DaysCents,
      creditsLast30DaysCents,
      cashSettledInvoiceCount: settledDays.length,
      meanDaysToCashSettlement: settledDays.length
        ? checkedSum(settledDays) / settledDays.length
        : null,
      dsoDays: null,
      signals,
    };
  });
}
