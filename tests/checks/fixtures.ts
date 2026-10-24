import type {
  CheckContext,
  DebtorPayment,
  Invoice,
  LedgerEntry,
  OutstandingFaceValue,
  ReceiptAllocation,
  SubmittedInvoice,
} from "@/lib/checks/types";
import { addDays } from "@/lib/dates";

export function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv_subject",
    batchId: "batch_current",
    clientId: "cli_test",
    debtorId: "dbt_test",
    invoiceNumber: "TEST-001",
    issueDate: "2026-10-01",
    dueDate: "2026-10-31",
    amountCents: 100_00,
    description: "Synthetic invoice",
    ...overrides,
  };
}

export function makeLedger(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  const invoice = makeInvoice();
  return {
    id: "led_subject",
    clientId: invoice.clientId,
    debtorId: invoice.debtorId,
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate,
    amountCents: invoice.amountCents,
    recordedDate: invoice.issueDate,
    supersedesLedgerEntryId: null,
    status: "AUTHORISED",
    creditNotes: [],
    ...overrides,
  };
}

export function makePayment(
  overrides: Partial<DebtorPayment> = {},
): DebtorPayment {
  return {
    id: "pay_history",
    debtorId: "dbt_test",
    ledgerEntryId: null,
    invoiceNumber: "HISTORY-001",
    issueDate: "2026-08-01",
    paidDate: "2026-08-31",
    amountCents: 100_00,
    ...overrides,
  };
}

export function paymentsTaking(days: number[]): DebtorPayment[] {
  return days.map((duration, index) =>
    makePayment({
      id: `pay_${index}`,
      issueDate: "2026-07-01",
      paidDate: addDays("2026-07-01", duration),
    }),
  );
}

export function makeOther(
  overrides: Partial<SubmittedInvoice> = {},
): SubmittedInvoice {
  return {
    ...makeInvoice({ id: "inv_other", batchId: "batch_previous" }),
    submittedDate: "2026-10-02",
    ledgerEntryId: "led_other",
    ledgerStatus: "AUTHORISED",
    ...overrides,
  };
}

export function makeReceipt(
  amountCents: number,
  id = "bank_receipt",
): ReceiptAllocation {
  return {
    ledgerEntryId: "led_subject",
    bankTransactionId: id,
    amountCents,
    bankTransaction: {
      id,
      clientId: "cli_test",
      date: "2026-10-22",
      amountCents: 100_000,
      counterpartyName: "Synthetic debtor",
      reference: "TEST-001",
    },
  };
}

export function makeOutstanding(invoice: Invoice): OutstandingFaceValue {
  return {
    debtorId: invoice.debtorId,
    amountCents: invoice.amountCents,
    invoices: [
      {
        invoiceId: invoice.id,
        amountCents: invoice.amountCents,
        fundingId: `fund_${invoice.id}`,
        fundedDate: "2026-10-02",
        advanceCents: Math.floor((invoice.amountCents * 8000) / 10000),
        outstandingCents: 1,
        adjustments: [],
      },
    ],
  };
}

export function makeContext(
  overrides: Partial<CheckContext> = {},
): CheckContext {
  const invoice = overrides.invoice ?? makeInvoice();
  return {
    invoice,
    submittedDate: "2026-10-23",
    client: {
      id: invoice.clientId,
      advanceRateBps: 8000,
      paymentTermsDays: 30,
    },
    debtor: { id: invoice.debtorId, firstSeenDate: "2025-01-01" },
    ledgerEntry: makeLedger({
      clientId: invoice.clientId,
      debtorId: invoice.debtorId,
      invoiceNumber: invoice.invoiceNumber,
      amountCents: invoice.amountCents,
      issueDate: invoice.issueDate,
    }),
    receiptAllocations: [],
    otherInvoices: [],
    supersededLedgerEntryIds: [],
    debtorPayments: [makePayment()],
    priorPayment: makePayment(),
    outstandingFaceValueByDebtor: [
      makeOutstanding(
        makeInvoice({
          id: "inv_funded",
          debtorId: "dbt_diverse",
          amountCents: 900_00,
        }),
      ),
    ],
    batchInvoices: [invoice],
    ...overrides,
  };
}
