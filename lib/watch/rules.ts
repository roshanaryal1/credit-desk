import { addDays, daysBetween } from "@/lib/dates";

import { WATCH_CONFIG } from "./config";
import { selectRiskPolicy, type RiskPolicy } from "./policy";
import { exposureByDebtor, outstandingOn } from "./exposure";
import { incidentKey } from "./keys";
import type { Book, Detection, WatchRule } from "./types";

// The five watch rules (SPEC 7). Each is pure over the book as of a date.

export type ClientThresholds = RiskPolicy["thresholds"];
export type ResolveThresholds = (clientId: string) => ClientThresholds;

const defaultThresholds = (): ClientThresholds => WATCH_CONFIG;

export const paymentDrift = (
  book: Book,
  resolve: ResolveThresholds = defaultThresholds,
): Detection[] => {
  const c = WATCH_CONFIG;
  const recentFrom = addDays(book.asOf, -c.driftRecentDays);
  const priorFrom = addDays(recentFrom, -c.driftPriorDays);
  const byDebtor = new Map<string, Book["payments"]>();
  for (const p of book.payments)
    byDebtor.set(p.debtorId, [...(byDebtor.get(p.debtorId) ?? []), p]);
  const out: Detection[] = [];
  for (const [debtorId, payments] of byDebtor) {
    const recent = payments.filter(
      (p) => p.paidDate > recentFrom && p.paidDate <= book.asOf,
    );
    const prior = payments.filter(
      (p) => p.paidDate > priorFrom && p.paidDate <= recentFrom,
    );
    if (recent.length < c.driftMinPayments || prior.length < c.driftMinPayments)
      continue;
    const mean = (ps: typeof payments) =>
      ps.reduce((s, p) => s + daysBetween(p.issueDate, p.paidDate), 0) /
      ps.length;
    const increase = mean(recent) - mean(prior);
    if (increase <= resolve(payments[0]!.clientId).driftIncreaseDays) continue;
    out.push({
      ruleId: "PAYMENT_DRIFT",
      incidentKey: incidentKey.paymentDrift(debtorId),
      clientId: payments[0]!.clientId,
      debtorId,
      fundingId: null,
      details: {
        recentMeanDays: Math.round(mean(recent)),
        priorMeanDays: Math.round(mean(prior)),
        recentPayments: recent.length,
        priorPayments: prior.length,
      },
      evidenceIds: [...recent, ...prior].map((p) => p.id),
    });
  }
  return out;
};

export const fundedCreditNote: WatchRule = (book) =>
  book.fundings.flatMap((f) => {
    if (!f.ledgerEntryId || outstandingOn(f, book.asOf) <= 0) return [];
    const notes = book.creditNotes.filter(
      (n) => n.ledgerEntryId === f.ledgerEntryId && n.date <= book.asOf,
    );
    if (notes.length === 0) return [];
    return [
      {
        ruleId: "FUNDED_CREDIT_NOTE" as const,
        incidentKey: incidentKey.fundedCreditNote(f.id),
        clientId: f.clientId,
        debtorId: f.debtorId,
        fundingId: f.id,
        details: {
          creditedCents: notes.reduce((s, n) => s + n.amountCents, 0),
          outstandingCents: outstandingOn(f, book.asOf),
        },
        evidenceIds: [f.id, f.invoiceId, ...notes.map((n) => n.id)],
      },
    ];
  });

export const overdueFunded = (
  book: Book,
  resolve: ResolveThresholds = defaultThresholds,
): Detection[] =>
  book.fundings.flatMap((f) => {
    const outstanding = outstandingOn(f, book.asOf);
    const daysOverdue = daysBetween(f.dueDate, book.asOf);
    if (outstanding <= 0 || daysOverdue <= resolve(f.clientId).overdueDays)
      return [];
    return [
      {
        ruleId: "OVERDUE_FUNDED" as const,
        incidentKey: incidentKey.overdueFunded(f.id),
        clientId: f.clientId,
        debtorId: f.debtorId,
        fundingId: f.id,
        details: {
          daysOverdue,
          outstandingCents: outstanding,
          dueDate: f.dueDate,
        },
        evidenceIds: [f.id, f.invoiceId],
      },
    ];
  });

export const concentrationCreep = (
  book: Book,
  resolve: ResolveThresholds = defaultThresholds,
): Detection[] => {
  const out: Detection[] = [];
  const over = (
    e: ReturnType<typeof exposureByDebtor>,
    d: string,
    clientId: string,
  ) =>
    e.total > 0 &&
    (e.byDebtor.get(d) ?? 0) * 10_000 >
      e.total * resolve(clientId).concentrationBps;
  for (const client of book.clients) {
    const now = exposureByDebtor(book, client.id, book.asOf);
    const before = exposureByDebtor(book, client.id, addDays(book.asOf, -1));
    for (const debtorId of now.byDebtor.keys()) {
      if (!over(now, debtorId, client.id) ||
          over(before, debtorId, client.id))
        continue;
      out.push({
        ruleId: "CONCENTRATION_CREEP",
        incidentKey: incidentKey.concentrationCreep(client.id, debtorId),
        clientId: client.id,
        debtorId,
        fundingId: null,
        details: {
          shareBps: Math.floor(
            ((now.byDebtor.get(debtorId) ?? 0) * 10_000) / now.total,
          ),
          debtorCents: now.byDebtor.get(debtorId),
          totalCents: now.total,
        },
        evidenceIds: book.fundings
          .filter(
            (f) =>
              f.clientId === client.id &&
              f.debtorId === debtorId &&
              outstandingOn(f, book.asOf) > 0,
          )
          .map((f) => f.id),
      });
    }
  }
  return out;
};

export const facilityUtilisation = (
  book: Book,
  resolve: ResolveThresholds = defaultThresholds,
): Detection[] =>
  book.clients.flatMap((client) => {
    const { total } = exposureByDebtor(book, client.id, book.asOf);
    if (
      total * 10_000 <=
      client.facilityLimitCents * resolve(client.id).facilityBps
    )
      return [];
    return [
      {
        ruleId: "FACILITY_UTILISATION" as const,
        incidentKey: incidentKey.facilityUtilisation(client.id),
        clientId: client.id,
        debtorId: null,
        fundingId: null,
        details: {
          fundsInUseCents: total,
          facilityLimitCents: client.facilityLimitCents,
        },
        evidenceIds: [],
      },
    ];
  });

export const WATCH_RULES = [
  paymentDrift,
  fundedCreditNote,
  overdueFunded,
  concentrationCreep,
  facilityUtilisation,
];

export function runWatchRules(book: Book): Detection[] {
  return WATCH_RULES.flatMap((rule) => rule(book));
}

/**
 * Opt-in pure simulation against effective-dated, independently approved
 * client policies. No incident writes or notification dispatch occur here.
 * Existing runWatchRules uses the unchanged deterministic demo defaults.
 */
export function runWatchRulesWithPolicies(
  book: Book,
  policies: readonly RiskPolicy[],
): Detection[] {
  const clientIds = new Set([
    ...book.clients.map((client) => client.id),
    ...book.fundings.map((funding) => funding.clientId),
    ...book.payments.map((payment) => payment.clientId),
  ]);
  const versions = new Map<string, RiskPolicy>();
  for (const clientId of clientIds) {
    const selected = selectRiskPolicy([...policies], clientId, book.asOf);
    if (!selected) {
      throw new Error(
        `No approved risk policy for client ${clientId} on ${book.asOf}`,
      );
    }
    versions.set(clientId, selected);
  }
  const resolve: ResolveThresholds = (clientId) => {
    const policy = versions.get(clientId);
    if (!policy) throw new Error("Unscoped client risk policy");
    return policy.thresholds;
  };
  const detections = [
    ...paymentDrift(book, resolve),
    ...fundedCreditNote(book),
    ...overdueFunded(book, resolve),
    ...concentrationCreep(book, resolve),
    ...facilityUtilisation(book, resolve),
  ];
  return detections.map((detection) => {
    const policy = versions.get(detection.clientId);
    if (!policy) throw new Error("Detection lacks an approved risk policy");
    return {
      ...detection,
      details: {
        ...detection.details,
        riskPolicyId: policy.id,
        riskPolicyEffectiveFrom: policy.effectiveFrom,
      },
    };
  });
}
