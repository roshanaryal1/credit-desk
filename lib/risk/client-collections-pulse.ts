import { daysBetween } from "@/lib/dates";
import type { getClientReceivablesAgeing } from "@/lib/queries/client-ageing";

type Ageing = NonNullable<Awaited<ReturnType<typeof getClientReceivablesAgeing>>>;

function checkedAmount(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid synthetic monetary source");
  }
}
function centsTotal(values: number[]) {
  const total = values.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error("Synthetic receivables overflow");
  }
  return total;
}

/**
 * Deterministic descriptive client-level cash/collections pulse. Uses the
 * SAME dated ledger-backed Client 360 data, never infers a default-risk score.
 */
export function collectionsRiskSummary(input: Ageing) {
  daysBetween(input.asOf, input.asOf);
  for (const value of [
    input.totalOutstandingCents,
    input.overdueCents,
    input.currentCents,
  ]) checkedAmount(value);
  if (
    input.totalOutstandingCents !==
    input.overdueCents + input.currentCents
  ) throw new Error("Client receivables summary does not reconcile");

  const byDebtor = new Map(input.debtors.map((row) => [row.debtorId, row]));
  const collectionIds = new Set<string>();
  if (byDebtor.size !== input.debtors.length ||
      input.collections.length !== input.debtors.length) {
    throw new Error("Missing or duplicated debtor collections history");
  }
  for (const row of input.collections) {
    if (collectionIds.has(row.debtorId) || !byDebtor.has(row.debtorId)) {
      throw new Error("Collections row belongs to another or repeated debtor");
    }
    collectionIds.add(row.debtorId);
  }
  const outstanding = centsTotal(input.debtors.map((r) => {
    checkedAmount(r.grossOutstandingCents);
    return r.grossOutstandingCents;
  }));
  const overdue = centsTotal(input.debtors.map((r) => {
    checkedAmount(r.overdueCents);
    return r.overdueCents;
  }));
  if (outstanding !== input.totalOutstandingCents ||
      overdue !== input.overdueCents) {
    throw new Error("Debtor amounts disagree with client ledger totals");
  }
  if (!input.debtors.length) {
    return {
      clientId: input.clientId,
      asOf: input.asOf,
      status: "INSUFFICIENT_SOURCE_RECORDS" as const,
      sourceClassification: "SYNTHETIC_LEDGER" as const,
      overdueNowCents: null,
      overduePrevious30DaysCents: null,
      overdueMovementCents: null,
      receiptsLast30DaysCents: null,
      receiptsPrevious30DaysCents: null,
      creditsLast30DaysCents: null,
      largestDebtor: null,
      observations: [],
      dsoDays: null,
    };
  }

  const previousOverdue = centsTotal(
    input.collections.map((r) => r.overdue30DaysAgoCents),
  );
  const receiptsRecent = centsTotal(
    input.collections.map((r) => r.receiptsLast30DaysCents),
  );
  const receiptsPrior = centsTotal(
    input.collections.map((r) => r.receiptsPrevious30DaysCents),
  );
  const creditsRecent = centsTotal(
    input.collections.map((r) => r.creditsLast30DaysCents),
  );
  for (const row of input.collections) {
    if (row.overdueMovement30DaysCents !==
        row.overdueNowCents - row.overdue30DaysAgoCents ||
        row.overdueNowCents !== byDebtor.get(row.debtorId)?.overdueCents) {
      throw new Error("Debtor collections movement does not reconcile");
    }
  }
  const largest = [...input.debtors].sort(
    (a, b) =>
      b.grossOutstandingCents - a.grossOutstandingCents ||
      a.debtorId.localeCompare(b.debtorId),
  )[0]!;
  const shareBps = outstanding > 0
    ? Number(
        (BigInt(largest.grossOutstandingCents) * BigInt(10_000)) /
          BigInt(outstanding),
      )
    : null;
  const observations = input.collections.flatMap((r) =>
    r.signals.map((s) => ({
      id: r.debtorId + ":" + s.code,
      debtorId: r.debtorId,
      debtorName: byDebtor.get(r.debtorId)!.debtorName,
      code: s.code,
      description: s.description,
      invoiceIds: [...new Set(s.invoiceIds)].sort(),
      sourceIds: [...new Set(s.sourceIds)].sort(),
    })),
  ).sort((a, b) => a.id.localeCompare(b.id));
  return {
    clientId: input.clientId,
    asOf: input.asOf,
    status: "DESCRIPTIVE_ONLY" as const,
    sourceClassification: "SYNTHETIC_LEDGER" as const,
    overdueNowCents: overdue,
    overduePrevious30DaysCents: previousOverdue,
    overdueMovementCents: overdue - previousOverdue,
    receiptsLast30DaysCents: receiptsRecent,
    receiptsPrevious30DaysCents: receiptsPrior,
    creditsLast30DaysCents: creditsRecent,
    largestDebtor: {
      id: largest.debtorId,
      name: largest.debtorName,
      outstandingCents: largest.grossOutstandingCents,
      shareBps,
      ledgerInvoiceIds: largest.invoices
        .filter((invoice) => invoice.outstandingCents > 0)
        .map((invoice) => invoice.invoiceId).sort(),
    },
    observations,
    dsoDays: null,
  };
}
