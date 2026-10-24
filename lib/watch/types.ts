import type { WatchRuleId } from "./config";

/** The funded book as of one date. Plain data; rules are pure over it. */
export interface Book {
  asOf: string;
  clients: { id: string; facilityLimitCents: number }[];
  fundings: {
    id: string;
    invoiceId: string;
    clientId: string;
    debtorId: string;
    ledgerEntryId: string | null;
    dueDate: string;
    fundedDate: string;
    advanceCents: number;
    /** Adjustments dated on or before the as-of date. */
    adjustments: { id: string; date: string; amountCents: number }[];
  }[];
  /** Credit notes dated on or before the as-of date, on funded invoices' ledger entries. */
  creditNotes: {
    id: string;
    ledgerEntryId: string;
    date: string;
    amountCents: number;
  }[];
  /** Debtor payments with a paid date in the drift windows. */
  payments: {
    id: string;
    debtorId: string;
    clientId: string;
    issueDate: string;
    paidDate: string;
  }[];
}

export interface Detection {
  ruleId: WatchRuleId;
  incidentKey: string;
  clientId: string;
  debtorId: string | null;
  fundingId: string | null;
  details: Record<string, unknown>;
  evidenceIds: string[];
}

export type WatchRule = (book: Book) => Detection[];
