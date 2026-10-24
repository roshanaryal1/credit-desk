// Source adapters (SPEC 4, Part A): every external system the desk reads
// from sits behind one of these interfaces, so swapping synthetic data for
// Xero (accounting) and Akahu (bank feeds) is a contained change.

export interface LedgerInvoice {
  externalId: string;
  invoiceNumber: string;
  debtorExternalId: string;
  amountCents: number;
  issueDate: string;
  status: "AUTHORISED" | "PAID" | "VOIDED";
  creditNotes: { externalId: string; date: string; amountCents: number }[];
}

export interface BankReceipt {
  externalId: string;
  date: string;
  amountCents: number;
  counterpartyName: string;
  reference: string;
}

/** The client's accounting system (Xero-shaped). */
export interface LedgerSource {
  readonly name: string;
  /** Invoices recorded on or before the date. */
  invoices(clientId: string, asOf: string): Promise<LedgerInvoice[]>;
}

/** The client's bank feed (Akahu-shaped). */
export interface BankFeedSource {
  readonly name: string;
  /** Receipts dated in [from, to]. */
  receipts(clientId: string, from: string, to: string): Promise<BankReceipt[]>;
}

export class SourceNotConfiguredError extends Error {
  constructor(source: string) {
    super(
      `${source} is not connected in this prototype; it uses synthetic data`,
    );
  }
}
