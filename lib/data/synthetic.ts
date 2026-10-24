import { and, eq, gte, inArray, lte } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

import type {
  BankFeedSource,
  BankReceipt,
  LedgerInvoice,
  LedgerSource,
} from "./types";

/** Ledger adapter over the synthetic tables. */
export class SyntheticLedger implements LedgerSource {
  readonly name = "synthetic-ledger";

  constructor(private readonly db: Db) {}

  async invoices(clientId: string, asOf: string): Promise<LedgerInvoice[]> {
    const entries = await this.db
      .select()
      .from(t.ledgerEntries)
      .where(
        and(
          eq(t.ledgerEntries.clientId, clientId),
          lte(t.ledgerEntries.recordedDate, asOf),
        ),
      );
    if (entries.length === 0) return [];
    const ids = entries.map((e) => e.id);
    const [events, notes] = await Promise.all([
      this.db
        .select()
        .from(t.ledgerStatusEvents)
        .where(
          and(
            inArray(t.ledgerStatusEvents.ledgerEntryId, ids),
            lte(t.ledgerStatusEvents.effectiveDate, asOf),
          ),
        ),
      this.db
        .select()
        .from(t.creditNotes)
        .where(
          and(
            inArray(t.creditNotes.ledgerEntryId, ids),
            lte(t.creditNotes.date, asOf),
          ),
        ),
    ]);
    return entries.map((e) => {
      const latest = events
        .filter((ev) => ev.ledgerEntryId === e.id)
        .sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1))
        .at(-1);
      return {
        externalId: e.id,
        invoiceNumber: e.invoiceNumber,
        debtorExternalId: e.debtorId,
        amountCents: e.amountCents,
        issueDate: e.issueDate,
        status: latest?.status ?? "AUTHORISED",
        creditNotes: notes
          .filter((n) => n.ledgerEntryId === e.id)
          .map((n) => ({
            externalId: n.id,
            date: n.date,
            amountCents: n.amountCents,
          })),
      };
    });
  }
}

/** Bank feed adapter over the synthetic tables. */
export class SyntheticBankFeed implements BankFeedSource {
  readonly name = "synthetic-bank-feed";

  constructor(private readonly db: Db) {}

  async receipts(
    clientId: string,
    from: string,
    to: string,
  ): Promise<BankReceipt[]> {
    const rows = await this.db
      .select()
      .from(t.bankTransactions)
      .where(
        and(
          eq(t.bankTransactions.clientId, clientId),
          gte(t.bankTransactions.date, from),
          lte(t.bankTransactions.date, to),
        ),
      );
    return rows.map((r) => ({
      externalId: r.id,
      date: r.date,
      amountCents: r.amountCents,
      counterpartyName: r.counterpartyName,
      reference: r.reference,
    }));
  }
}
