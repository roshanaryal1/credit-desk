export type CheckId =
  | "DUP"
  | "LEDGER_MISSING"
  | "LEDGER_MISMATCH"
  | "VOIDED"
  | "CREDIT_NOTE"
  | "ALREADY_PAID"
  | "NEW_DEBTOR"
  | "SLOW_PAYER"
  | "OVER_AGE"
  | "FUTURE_DATED"
  | "CONCENTRATION";

export type Severity = "LOW" | "MEDIUM" | "HIGH";

export interface Finding {
  checkId: CheckId;
  severity: Severity;
  details: Record<string, unknown>;
  evidenceIds: string[];
}

export interface Invoice {
  id: string;
  batchId: string;
  clientId: string;
  debtorId: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  amountCents: number;
  description: string;
}

export type LedgerStatus = "AUTHORISED" | "PAID" | "VOIDED";

export interface CreditNote {
  id: string;
  ledgerEntryId: string;
  date: string;
  amountCents: number;
}

export interface LedgerEntry {
  id: string;
  clientId: string;
  invoiceNumber: string;
  debtorId: string;
  amountCents: number;
  issueDate: string;
  recordedDate: string;
  supersedesLedgerEntryId: string | null;
  status: LedgerStatus | null;
  creditNotes: CreditNote[];
}

export interface ReceiptAllocation {
  ledgerEntryId: string;
  bankTransactionId: string;
  amountCents: number;
  bankTransaction: {
    id: string;
    clientId: string;
    date: string;
    amountCents: number;
    counterpartyName: string;
    reference: string;
  };
}

export interface DebtorPayment {
  id: string;
  debtorId: string;
  ledgerEntryId: string | null;
  invoiceNumber: string;
  issueDate: string;
  paidDate: string;
  amountCents: number;
}

export interface SubmittedInvoice extends Invoice {
  submittedDate: string;
  ledgerEntryId: string | null;
  ledgerStatus: LedgerStatus | null;
}

export interface OutstandingFundedInvoice {
  invoiceId: string;
  amountCents: number;
  fundingId: string;
  fundedDate: string;
  advanceCents: number;
  outstandingCents: number;
  adjustments: {
    id: string;
    fundingId: string;
    date: string;
    kind: "COLLECTION" | "DILUTION" | "WRITE_OFF";
    amountCents: number;
  }[];
}

export interface OutstandingFaceValue {
  debtorId: string;
  amountCents: number;
  invoices: OutstandingFundedInvoice[];
}

// A serialisable snapshot; all temporal and client filtering happens in the loader.
export interface CheckContext {
  invoice: Invoice;
  submittedDate: string;
  client: { id: string; advanceRateBps: number; paymentTermsDays: number };
  debtor: { id: string; firstSeenDate: string };
  ledgerEntry: LedgerEntry | null;
  receiptAllocations: ReceiptAllocation[];
  otherInvoices: SubmittedInvoice[];
  supersededLedgerEntryIds: string[];
  // [submission - lookback days, submission), for SLOW_PAYER.
  debtorPayments: DebtorPayment[];
  // Lifetime evidence for NEW_DEBTOR, including payments older than the window.
  priorPayment: DebtorPayment | null;
  outstandingFaceValueByDebtor: OutstandingFaceValue[];
  batchInvoices: Invoice[];
}

export type Check = (invoice: Invoice, ctx: CheckContext) => Finding | null;
