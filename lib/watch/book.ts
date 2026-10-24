import { eq } from "drizzle-orm";

import { addDays } from "@/lib/dates";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

import { WATCH_CONFIG } from "./config";
import type { Book } from "./types";

/** Everything the watch rules can ever need, loaded once. */
export async function loadBookSource(db: Db) {
  const [clients, fundings, adjustments, ledger, creditNotes, payments] =
    await Promise.all([
      db
        .select({
          id: t.clients.id,
          facilityLimitCents: t.clients.facilityLimitCents,
        })
        .from(t.clients),
      db
        .select({ funding: t.fundings, invoice: t.invoices })
        .from(t.fundings)
        .innerJoin(t.invoices, eq(t.fundings.invoiceId, t.invoices.id)),
      db.select().from(t.fundingAdjustments),
      db
        .select({
          id: t.ledgerEntries.id,
          clientId: t.ledgerEntries.clientId,
          invoiceNumber: t.ledgerEntries.invoiceNumber,
          recordedDate: t.ledgerEntries.recordedDate,
        })
        .from(t.ledgerEntries),
      db.select().from(t.creditNotes),
      db
        .select({ payment: t.debtorPayments, clientId: t.debtors.clientId })
        .from(t.debtorPayments)
        .innerJoin(t.debtors, eq(t.debtorPayments.debtorId, t.debtors.id)),
    ]);
  return { clients, fundings, adjustments, ledger, creditNotes, payments };
}

export type BookSource = Awaited<ReturnType<typeof loadBookSource>>;

/** The book as of a date: only records effective on or before it (no look-ahead). */
export function bookAsOf(src: BookSource, asOf: string): Book {
  const ledgerByKey = new Map(
    src.ledger.map((l) => [`${l.clientId}|${l.invoiceNumber}`, l]),
  );
  const fundings = src.fundings
    .filter(({ funding }) => funding.fundedDate <= asOf)
    .map(({ funding, invoice }) => {
      const led = ledgerByKey.get(
        `${invoice.clientId}|${invoice.invoiceNumber}`,
      );
      return {
        id: funding.id,
        invoiceId: invoice.id,
        clientId: invoice.clientId,
        debtorId: invoice.debtorId,
        ledgerEntryId: led && led.recordedDate <= asOf ? led.id : null,
        dueDate: invoice.dueDate,
        fundedDate: funding.fundedDate,
        advanceCents: funding.advanceCents,
        adjustments: src.adjustments
          .filter((a) => a.fundingId === funding.id && a.date <= asOf)
          .map((a) => ({ id: a.id, date: a.date, amountCents: a.amountCents })),
      };
    });
  const fundedLedger = new Set(
    fundings.map((f) => f.ledgerEntryId).filter((x): x is string => x !== null),
  );
  const windowStart = addDays(
    asOf,
    -(WATCH_CONFIG.driftRecentDays + WATCH_CONFIG.driftPriorDays),
  );
  return {
    asOf,
    clients: src.clients,
    fundings,
    creditNotes: src.creditNotes
      .filter((n) => fundedLedger.has(n.ledgerEntryId) && n.date <= asOf)
      .map((n) => ({
        id: n.id,
        ledgerEntryId: n.ledgerEntryId,
        date: n.date,
        amountCents: n.amountCents,
      })),
    payments: src.payments
      .filter(
        ({ payment }) =>
          payment.paidDate > windowStart && payment.paidDate <= asOf,
      )
      .map(({ payment, clientId }) => ({
        id: payment.id,
        debtorId: payment.debtorId,
        clientId,
        issueDate: payment.issueDate,
        paidDate: payment.paidDate,
      })),
  };
}
