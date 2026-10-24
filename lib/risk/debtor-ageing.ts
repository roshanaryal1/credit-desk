/**
 * Deterministic as-of receivables ageing. Inputs are reconciled per-invoice
 * allocations; the importer must provide authenticated, source-dated records.
 * No prediction, LLM or unverifiable debtor score is involved.
 */

export type AgeBucket =
  "CURRENT" | "DAYS_1_30" | "DAYS_31_60" | "DAYS_61_90" | "DAYS_90_PLUS";

export interface DatedAmount {
  sourceId: string;
  effectiveDate: string;
  cents: number;
}

export interface AgeingReceivable {
  invoiceId: string;
  debtorId: string;
  issuedDate: string;
  dueDate: string;
  faceCents: number;
  receiptAllocations: DatedAmount[];
  creditNotes: DatedAmount[];
}

export interface AgedInvoice {
  invoiceId: string;
  debtorId: string;
  outstandingCents: number;
  daysPastDue: number;
  bucket: AgeBucket;
  countedReceiptCents: number;
  countedCreditCents: number;
}

export interface DebtorAgeing {
  debtorId: string;
  grossOutstandingCents: number;
  overdueCents: number;
  buckets: Record<AgeBucket, number>;
  paymentsLast30DaysCents: number;
  paymentsPrevious30DaysCents: number;
  invoices: AgedInvoice[];
}

const DAY_MS = 86_400_000;
const BUCKETS: AgeBucket[] = [
  "CURRENT",
  "DAYS_1_30",
  "DAYS_31_60",
  "DAYS_61_90",
  "DAYS_90_PLUS",
];

function dateToDay(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Expected YYYY-MM-DD business date");
  }
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(ms) ||
    new Date(ms).toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Invalid business date");
  }
  return Math.floor(ms / DAY_MS);
}

function amount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be non-negative safe integer cents`);
  }
}

function sum(values: number[]): number {
  const total = values.reduce((acc, value) => acc + value, 0);
  if (!Number.isSafeInteger(total)) throw new Error("Monetary total overflow");
  return total;
}

function classify(days: number): AgeBucket {
  if (days <= 0) return "CURRENT";
  if (days <= 30) return "DAYS_1_30";
  if (days <= 60) return "DAYS_31_60";
  if (days <= 90) return "DAYS_61_90";
  return "DAYS_90_PLUS";
}

export function debtorAgeing(
  asOfDate: string,
  receivables: AgeingReceivable[],
): DebtorAgeing[] {
  const asOf = dateToDay(asOfDate);
  const ids = new Set<string>();
  const byDebtor = new Map<string, DebtorAgeing>();

  for (const invoice of [...receivables].sort((a, b) =>
    a.invoiceId.localeCompare(b.invoiceId),
  )) {
    if (!invoice.invoiceId.trim() || !invoice.debtorId.trim()) {
      throw new Error("Invoice and debtor IDs required");
    }
    if (ids.has(invoice.invoiceId)) {
      throw new Error(`Duplicate invoice ${invoice.invoiceId}`);
    }
    ids.add(invoice.invoiceId);
    amount(invoice.faceCents, "face");
    const issued = dateToDay(invoice.issuedDate);
    const due = dateToDay(invoice.dueDate);
    if (due < issued) throw new Error("Due date precedes issue date");

    const seenEvents = new Set<string>();
    for (const event of [
      ...invoice.receiptAllocations,
      ...invoice.creditNotes,
    ]) {
      if (!event.sourceId.trim())
        throw new Error("Allocation source ID required");
      dateToDay(event.effectiveDate);
      amount(event.cents, "allocation");
      if (seenEvents.has(event.sourceId)) {
        throw new Error(`Repeated allocation/credit ID ${event.sourceId}`);
      }
      seenEvents.add(event.sourceId);
    }
    // Future invoices do not belong to this as-of portfolio.
    if (issued > asOf) continue;

    const eligibleEvents = (items: DatedAmount[]) =>
      items.filter((event) => dateToDay(event.effectiveDate) <= asOf);
    const receipts = eligibleEvents(invoice.receiptAllocations);
    const credits = eligibleEvents(invoice.creditNotes);
    const countedReceiptCents = sum(receipts.map((event) => event.cents));
    const countedCreditCents = sum(credits.map((event) => event.cents));
    const deducted = sum([countedReceiptCents, countedCreditCents]);
    if (deducted > invoice.faceCents) {
      throw new Error(`Allocations exceed receivable ${invoice.invoiceId}`);
    }
    const outstandingCents = invoice.faceCents - deducted;
    const daysPastDue = Math.max(0, asOf - due);
    const bucket = classify(daysPastDue);
    let group = byDebtor.get(invoice.debtorId);
    if (!group) {
      group = {
        debtorId: invoice.debtorId,
        grossOutstandingCents: 0,
        overdueCents: 0,
        buckets: Object.fromEntries(BUCKETS.map((key) => [key, 0])) as Record<
          AgeBucket,
          number
        >,
        paymentsLast30DaysCents: 0,
        paymentsPrevious30DaysCents: 0,
        invoices: [],
      };
      byDebtor.set(invoice.debtorId, group);
    }
    group.grossOutstandingCents = sum([
      group.grossOutstandingCents,
      outstandingCents,
    ]);
    group.buckets[bucket] = sum([group.buckets[bucket], outstandingCents]);
    if (daysPastDue > 0)
      group.overdueCents = sum([group.overdueCents, outstandingCents]);
    for (const receipt of receipts) {
      const age = asOf - dateToDay(receipt.effectiveDate);
      if (age < 30) {
        group.paymentsLast30DaysCents = sum([
          group.paymentsLast30DaysCents,
          receipt.cents,
        ]);
      } else if (age < 60) {
        group.paymentsPrevious30DaysCents = sum([
          group.paymentsPrevious30DaysCents,
          receipt.cents,
        ]);
      }
    }
    group.invoices.push({
      invoiceId: invoice.invoiceId,
      debtorId: invoice.debtorId,
      outstandingCents,
      daysPastDue,
      bucket,
      countedReceiptCents,
      countedCreditCents,
    });
  }
  return [...byDebtor.values()].sort((a, b) =>
    a.debtorId.localeCompare(b.debtorId),
  );
}
