import { addDays, daysBetween } from "@/lib/dates";
import { HISTORY_DAYS } from "@/lib/demo";
import { incidentKey } from "@/lib/watch/keys";

import type { Dataset } from "./generate";

// Reference calculations over a generated book. These restate SPEC 6 and 7 in
// the simplest possible form, independently of lib/checks and lib/watch, and
// are used only to produce ground-truth labels. They run once per dataset.

const SHARE_LIMIT_BPS = 3000;
const OVERDUE_DAYS = 30;
const DRIFT_RECENT_DAYS = 60;
const DRIFT_PRIOR_DAYS = 90;
const DRIFT_MIN_PAYMENTS = 3;
const DRIFT_INCREASE_DAYS = 15;
const FACILITY_LIMIT_BPS = 9000;
const DUP_WINDOW_DAYS = 7;
const PAID_COVERAGE_BPS = 9900;

interface ScriptedDebtors {
  driftDebtorId: string | null;
  concentratedDebtorId: string | null;
}

export function applyReferenceLabels(
  ds: Dataset,
  scripted: ScriptedDebtors,
): Dataset {
  const today = ds.params.demoToday;
  const historyStart = addDays(today, -HISTORY_DAYS);

  const batchById = new Map(ds.batches.map((b) => [b.id!, b]));
  const invoiceById = new Map(ds.invoices.map((i) => [i.id!, i]));
  const submittedOf = (invoiceId: string) =>
    batchById.get(invoiceById.get(invoiceId)!.batchId)!.submittedDate;
  const ledgerFor = (clientId: string, invoiceNumber: string, asOf: string) =>
    ds.ledgerEntries.find(
      (l) =>
        l.clientId === clientId &&
        l.invoiceNumber === invoiceNumber &&
        l.recordedDate <= asOf,
    );
  const statusOn = (ledgerId: string, asOf: string) =>
    ds.ledgerStatusEvents
      .filter((e) => e.ledgerEntryId === ledgerId && e.effectiveDate <= asOf)
      .sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1))
      .at(-1)?.status;
  const bankDate = new Map(ds.bankTransactions.map((t) => [t.id!, t.date]));

  const adjustmentsByFunding = new Map<
    string,
    { date: string; amount: number }[]
  >();
  for (const a of ds.fundingAdjustments) {
    const rows = adjustmentsByFunding.get(a.fundingId) ?? [];
    rows.push({ date: a.date, amount: a.amountCents });
    adjustmentsByFunding.set(a.fundingId, rows);
  }
  const outstandingCents = (fundingId: string, advance: number, asOf: string) =>
    advance -
    (adjustmentsByFunding.get(fundingId) ?? [])
      .filter((a) => a.date <= asOf)
      .reduce((sum, a) => sum + a.amount, 0);
  const openFundings = (clientId: string, asOf: string) =>
    ds.fundings
      .map((f) => ({ f, inv: invoiceById.get(f.invoiceId)! }))
      .filter(
        ({ f, inv }) =>
          inv.clientId === clientId &&
          f.fundedDate <= asOf &&
          outstandingCents(f.id!, f.advanceCents, asOf) > 0,
      );

  // Invoice labels

  const labels = new Map(
    ds.labels.map((l) => [l.invoiceId, new Set(l.expectedCheckIds)]),
  );
  for (const inv of ds.invoices) {
    const sub = submittedOf(inv.id!);
    const set = labels.get(inv.id!)!;
    const ledger = ledgerFor(inv.clientId, inv.invoiceNumber, sub);

    // ALREADY_PAID: receipts dated before submission cover 99% of face value.
    if (ledger) {
      const allocated = ds.receiptAllocations
        .filter((a) => a.ledgerEntryId === ledger.id)
        .filter((a) => bankDate.get(a.bankTransactionId)! < sub)
        .reduce((sum, a) => sum + a.amountCents, 0);
      if (
        allocated > 0 &&
        allocated * 10_000 >= inv.amountCents * PAID_COVERAGE_BPS
      ) {
        set.add("ALREADY_PAID");
      }
    }

    // CONCENTRATION: outstanding funded face value plus this batch, by debtor.
    const face = new Map<string, number>();
    for (const { inv: funded } of openFundings(inv.clientId, sub)) {
      face.set(funded.id!, funded.amountCents);
    }
    for (const other of ds.invoices) {
      if (other.batchId === inv.batchId) face.set(other.id!, other.amountCents);
    }
    let total = 0;
    let mine = 0;
    for (const [id, amount] of face) {
      total += amount;
      if (invoiceById.get(id)!.debtorId === inv.debtorId) mine += amount;
    }
    if (total > 0 && mine * 10_000 > total * SHARE_LIMIT_BPS) {
      set.add("CONCENTRATION");
    }

    // DUP: same number, or same debtor and amount within 7 days, among other
    // submissions up to this one, ignoring a voided original this one replaces.
    const isDup = ds.invoices.some((other) => {
      if (other.id === inv.id || other.clientId !== inv.clientId) return false;
      if (submittedOf(other.id!) > sub) return false;
      const otherLedger = ledgerFor(other.clientId, other.invoiceNumber, sub);
      if (
        otherLedger &&
        ledger?.supersedesLedgerEntryId === otherLedger.id &&
        statusOn(otherLedger.id!, sub) === "VOIDED"
      ) {
        return false;
      }
      return (
        other.invoiceNumber === inv.invoiceNumber ||
        (other.debtorId === inv.debtorId &&
          other.amountCents === inv.amountCents &&
          Math.abs(daysBetween(other.issueDate, inv.issueDate)) <=
            DUP_WINDOW_DAYS)
      );
    });
    if (isDup) set.add("DUP");
  }
  ds.labels = ds.labels.map((l) => ({
    invoiceId: l.invoiceId,
    expectedCheckIds: [...labels.get(l.invoiceId)!].sort(),
  }));

  // Watch labels: the first date each incident's rule holds in the history.

  const first = new Map<string, { ruleId: string; date: string }>();
  const mark = (ruleId: string, key: string, date: string) => {
    if (!first.has(key)) first.set(key, { ruleId, date });
  };
  const exposureShares = (clientId: string, asOf: string) => {
    const byDebtor = new Map<string, number>();
    let total = 0;
    for (const { f, inv } of openFundings(clientId, asOf)) {
      const cents = outstandingCents(f.id!, f.advanceCents, asOf);
      byDebtor.set(inv.debtorId, (byDebtor.get(inv.debtorId) ?? 0) + cents);
      total += cents;
    }
    return { byDebtor, total };
  };
  const overLimit = (
    share: { byDebtor: Map<string, number>; total: number },
    debtorId: string,
  ) =>
    share.total > 0 &&
    (share.byDebtor.get(debtorId) ?? 0) * 10_000 >
      share.total * SHARE_LIMIT_BPS;
  const daysToPay = (from: string, to: string, debtorId: string) =>
    ds.debtorPayments
      .filter(
        (p) => p.debtorId === debtorId && p.paidDate > from && p.paidDate <= to,
      )
      .map((p) => daysBetween(p.issueDate, p.paidDate));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  for (let d = historyStart; d <= today; d = addDays(d, 1)) {
    for (const client of ds.clients) {
      for (const { f, inv } of openFundings(client.id!, d)) {
        if (daysBetween(inv.dueDate, d) > OVERDUE_DAYS) {
          mark("OVERDUE_FUNDED", incidentKey.overdueFunded(f.id!), d);
        }
        const ledger = ledgerFor(inv.clientId, inv.invoiceNumber, d);
        if (
          ledger &&
          ds.creditNotes.some(
            (c) => c.ledgerEntryId === ledger.id && c.date <= d,
          )
        ) {
          mark("FUNDED_CREDIT_NOTE", incidentKey.fundedCreditNote(f.id!), d);
        }
      }

      const now = exposureShares(client.id!, d);
      const before = exposureShares(client.id!, addDays(d, -1));
      for (const debtorId of now.byDebtor.keys()) {
        if (overLimit(now, debtorId) && !overLimit(before, debtorId)) {
          mark(
            "CONCENTRATION_CREEP",
            incidentKey.concentrationCreep(client.id!, debtorId),
            d,
          );
        }
      }

      if (now.total * 10_000 > client.facilityLimitCents * FACILITY_LIMIT_BPS) {
        mark(
          "FACILITY_UTILISATION",
          incidentKey.facilityUtilisation(client.id!),
          d,
        );
      }
    }

    for (const debtor of ds.debtors) {
      const recent = daysToPay(addDays(d, -DRIFT_RECENT_DAYS), d, debtor.id!);
      const prior = daysToPay(
        addDays(d, -(DRIFT_RECENT_DAYS + DRIFT_PRIOR_DAYS)),
        addDays(d, -DRIFT_RECENT_DAYS),
        debtor.id!,
      );
      if (
        recent.length >= DRIFT_MIN_PAYMENTS &&
        prior.length >= DRIFT_MIN_PAYMENTS &&
        mean(recent) - mean(prior) > DRIFT_INCREASE_DAYS
      ) {
        mark("PAYMENT_DRIFT", incidentKey.paymentDrift(debtor.id!), d);
      }
    }
  }

  ds.watchLabels = [...first.entries()]
    .map(([key, { ruleId, date }]) => ({
      ruleId,
      incidentKey: key,
      expectedFromDate: date,
      expectedToDate: addDays(date, 1),
    }))
    .sort((a, b) => (a.incidentKey < b.incidentKey ? -1 : 1));

  // Every scripted story must be detectable under the rules.
  if (scripted.driftDebtorId) {
    const hit = first.get(incidentKey.paymentDrift(scripted.driftDebtorId));
    if (!hit) throw new Error("scripted PAYMENT_DRIFT is not detectable");
    const event = ds.scriptedEvents.find((e) => e.kind === "PAYMENT_DRIFT");
    if (event) event.date = hit.date;
  }
  if (scripted.concentratedDebtorId) {
    const debtor = ds.debtors.find(
      (x) => x.id === scripted.concentratedDebtorId,
    )!;
    const hit = first.get(
      incidentKey.concentrationCreep(debtor.clientId, debtor.id!),
    );
    if (!hit) throw new Error("scripted CONCENTRATION_CREEP is not detectable");
    ds.scriptedEvents.push({
      kind: "CONCENTRATION_CREEP",
      date: hit.date,
      description: `Debtor ${debtor.name} passes 30% of the client's outstanding exposure`,
    });
  }
  for (const e of ds.scriptedEvents) {
    const rule = e.kind;
    if (![...first.values()].some((v) => v.ruleId === rule)) {
      throw new Error(`scripted ${rule} has no matching watch label`);
    }
  }
  return ds;
}
