import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildCheckContext } from "@/lib/checks/context";
import { runChecks } from "@/lib/checks";
import type { CheckContext } from "@/lib/checks/types";
import { createMemoryDb, type Db } from "@/lib/db/client";
import {
  bankTransactions,
  batches,
  clients,
  creditNotes,
  debtorPayments,
  debtors,
  fundingAdjustments,
  fundings,
  invoices,
  ledgerEntries,
  ledgerStatusEvents,
  receiptAllocations,
} from "@/lib/db/schema";
import { makeInvoice, makeLedger, makePayment } from "@/tests/checks/fixtures";

let db: Db;
let beforeFuture: CheckContext;
let afterFuture: CheckContext;

beforeAll(async () => {
  db = await createMemoryDb();
  await db.insert(clients).values([
    {
      id: "cli_test",
      name: "Synthetic client",
      industry: "testing",
      facilityLimitCents: 1_000_000,
      paymentTermsDays: 30,
    },
    {
      id: "cli_foreign",
      name: "Synthetic second client",
      industry: "testing",
      facilityLimitCents: 1_000_000,
      paymentTermsDays: 60,
    },
  ]);
  await db.insert(debtors).values([
    {
      id: "dbt_test",
      clientId: "cli_test",
      name: "Synthetic debtor",
      nzbn: "9429000000001",
      firstSeenDate: "2025-01-01",
      creditBand: "B",
    },
    {
      id: "dbt_diverse",
      clientId: "cli_test",
      name: "Synthetic second debtor",
      nzbn: "9429000000002",
      firstSeenDate: "2025-01-01",
      creditBand: "B",
    },
    {
      id: "dbt_foreign",
      clientId: "cli_foreign",
      name: "Synthetic foreign debtor",
      nzbn: "9429000000003",
      firstSeenDate: "2025-01-01",
      creditBand: "B",
    },
  ]);
  await db.insert(batches).values([
    {
      id: "batch_current",
      clientId: "cli_test",
      submittedDate: "2026-10-23",
      status: "PENDING",
    },
    {
      id: "batch_previous",
      clientId: "cli_test",
      submittedDate: "2026-10-01",
      status: "REVIEWED",
    },
    {
      id: "batch_same_day",
      clientId: "cli_test",
      submittedDate: "2026-10-23",
      status: "PENDING",
    },
    {
      id: "batch_foreign",
      clientId: "cli_foreign",
      submittedDate: "2026-10-01",
      status: "REVIEWED",
    },
  ]);
  await db.insert(invoices).values([
    makeInvoice(),
    makeInvoice({
      id: "inv_original",
      batchId: "batch_previous",
      invoiceNumber: "ORIGINAL",
      issueDate: "2026-09-30",
    }),
    makeInvoice({
      id: "inv_funded",
      batchId: "batch_previous",
      invoiceNumber: "FUNDED",
      debtorId: "dbt_diverse",
      amountCents: 100000,
    }),
    makeInvoice({
      id: "inv_settled",
      batchId: "batch_previous",
      invoiceNumber: "SETTLED",
      debtorId: "dbt_diverse",
      amountCents: 100000,
    }),
    makeInvoice({
      id: "inv_future_funding",
      batchId: "batch_previous",
      invoiceNumber: "FUTURE-FUNDING",
      debtorId: "dbt_diverse",
      amountCents: 100000,
    }),
    makeInvoice({
      id: "inv_late_ledger",
      batchId: "batch_same_day",
      invoiceNumber: "LATE",
      amountCents: 20000,
    }),
    makeInvoice({
      id: "inv_recorded_today",
      invoiceNumber: "RECORDED-TODAY",
      amountCents: 30000,
    }),
    makeInvoice({
      id: "inv_foreign",
      batchId: "batch_foreign",
      clientId: "cli_foreign",
      debtorId: "dbt_foreign",
    }),
  ]);
  const { status: _status, creditNotes: _notes, ...ledger } = makeLedger();
  void _status;
  void _notes;
  await db.insert(ledgerEntries).values([
    { ...ledger, supersedesLedgerEntryId: "led_original" },
    {
      ...ledger,
      id: "led_original",
      invoiceNumber: "ORIGINAL",
      issueDate: "2026-09-30",
      recordedDate: "2026-09-30",
    },
    {
      ...ledger,
      id: "led_recorded_today",
      invoiceNumber: "RECORDED-TODAY",
      amountCents: 30000,
      recordedDate: "2026-10-23",
    },
    {
      ...ledger,
      id: "led_foreign",
      clientId: "cli_foreign",
      debtorId: "dbt_foreign",
    },
  ]);
  await db.insert(ledgerStatusEvents).values([
    {
      ledgerEntryId: "led_subject",
      status: "AUTHORISED",
      effectiveDate: "2026-10-01",
    },
    {
      ledgerEntryId: "led_original",
      status: "AUTHORISED",
      effectiveDate: "2026-09-30",
    },
    {
      ledgerEntryId: "led_original",
      status: "VOIDED",
      effectiveDate: "2026-10-23",
    },
    {
      ledgerEntryId: "led_foreign",
      status: "VOIDED",
      effectiveDate: "2026-10-01",
    },
  ]);
  await db.insert(creditNotes).values([
    {
      id: "cn_before",
      ledgerEntryId: "led_subject",
      date: "2026-10-22",
      amountCents: 1000,
    },
    {
      id: "cn_today",
      ledgerEntryId: "led_subject",
      date: "2026-10-23",
      amountCents: 1000,
    },
    {
      id: "cn_foreign",
      ledgerEntryId: "led_foreign",
      date: "2026-10-01",
      amountCents: 9000,
    },
  ]);
  await db.insert(bankTransactions).values([
    {
      id: "bank_before",
      clientId: "cli_test",
      date: "2026-10-22",
      amountCents: 100000,
      counterpartyName: "Synthetic debtor",
      reference: "TEST-001",
    },
    {
      id: "bank_foreign",
      clientId: "cli_foreign",
      date: "2026-10-22",
      amountCents: 100000,
      counterpartyName: "Synthetic foreign debtor",
      reference: "TEST-001",
    },
  ]);
  await db.insert(receiptAllocations).values([
    {
      ledgerEntryId: "led_subject",
      bankTransactionId: "bank_before",
      amountCents: 5000,
    },
    {
      ledgerEntryId: "led_foreign",
      bankTransactionId: "bank_foreign",
      amountCents: 10000,
    },
  ]);
  await db.insert(debtorPayments).values([
    makePayment({ id: "pay_before", paidDate: "2026-10-22" }),
    makePayment({
      id: "pay_boundary",
      issueDate: "2025-09-01",
      paidDate: "2025-10-23",
    }),
    makePayment({
      id: "pay_outside",
      issueDate: "2025-09-01",
      paidDate: "2025-10-22",
    }),
    makePayment({
      id: "pay_old_diverse",
      debtorId: "dbt_diverse",
      issueDate: "2025-01-01",
      paidDate: "2025-01-31",
    }),
    makePayment({ id: "pay_foreign", debtorId: "dbt_foreign" }),
  ]);
  await db.insert(fundings).values([
    {
      id: "fund_subject",
      invoiceId: "inv_subject",
      fundedDate: "2026-10-23",
      advanceCents: 8000,
    },
    {
      id: "fund_partial",
      invoiceId: "inv_funded",
      fundedDate: "2026-10-01",
      advanceCents: 80000,
    },
    {
      id: "fund_settled",
      invoiceId: "inv_settled",
      fundedDate: "2026-10-01",
      advanceCents: 80000,
    },
    {
      id: "fund_foreign",
      invoiceId: "inv_foreign",
      fundedDate: "2026-10-01",
      advanceCents: 8000,
    },
  ]);
  await db.insert(fundingAdjustments).values([
    {
      id: "adj_partial",
      fundingId: "fund_partial",
      date: "2026-10-23",
      kind: "COLLECTION",
      amountCents: 30000,
    },
    {
      id: "adj_collection",
      fundingId: "fund_settled",
      date: "2026-10-22",
      kind: "COLLECTION",
      amountCents: 30000,
    },
    {
      id: "adj_dilution",
      fundingId: "fund_settled",
      date: "2026-10-23",
      kind: "DILUTION",
      amountCents: 30000,
    },
    {
      id: "adj_write_off",
      fundingId: "fund_settled",
      date: "2026-10-23",
      kind: "WRITE_OFF",
      amountCents: 20000,
    },
  ]);

  beforeFuture = await buildCheckContext(db, "inv_subject");

  await db.insert(ledgerStatusEvents).values({
    ledgerEntryId: "led_subject",
    status: "VOIDED",
    effectiveDate: "2026-10-24",
  });
  await db.insert(creditNotes).values({
    id: "cn_future",
    ledgerEntryId: "led_subject",
    date: "2026-10-24",
    amountCents: 9000,
  });
  await db
    .insert(debtorPayments)
    .values([
      makePayment({ id: "pay_future", paidDate: "2026-10-24" }),
      makePayment({ id: "pay_today", paidDate: "2026-10-23" }),
    ]);
  await db.insert(bankTransactions).values([
    {
      id: "bank_future",
      clientId: "cli_test",
      date: "2026-10-24",
      amountCents: 10000,
      counterpartyName: "Synthetic debtor",
      reference: "TEST-001",
    },
    {
      id: "bank_today",
      clientId: "cli_test",
      date: "2026-10-23",
      amountCents: 10000,
      counterpartyName: "Synthetic debtor",
      reference: "TEST-001",
    },
  ]);
  await db.insert(receiptAllocations).values([
    {
      ledgerEntryId: "led_subject",
      bankTransactionId: "bank_future",
      amountCents: 10000,
    },
    {
      ledgerEntryId: "led_subject",
      bankTransactionId: "bank_today",
      amountCents: 10000,
    },
  ]);
  await db.insert(ledgerEntries).values({
    ...ledger,
    id: "led_late",
    invoiceNumber: "LATE",
    recordedDate: "2026-10-24",
  });
  await db.insert(ledgerStatusEvents).values({
    ledgerEntryId: "led_late",
    status: "VOIDED",
    effectiveDate: "2026-10-01",
  });
  await db.insert(creditNotes).values({
    id: "cn_late",
    ledgerEntryId: "led_late",
    date: "2026-10-01",
    amountCents: 100,
  });
  await db.insert(batches).values({
    id: "batch_future",
    clientId: "cli_test",
    submittedDate: "2026-10-24",
    status: "PENDING",
  });
  await db
    .insert(invoices)
    .values(makeInvoice({ id: "inv_future", batchId: "batch_future" }));
  await db.insert(fundings).values({
    id: "fund_future",
    invoiceId: "inv_future_funding",
    fundedDate: "2026-10-24",
    advanceCents: 80000,
  });
  await db.insert(fundingAdjustments).values({
    id: "adj_future",
    fundingId: "fund_partial",
    date: "2026-10-24",
    kind: "COLLECTION",
    amountCents: 50000,
  });

  afterFuture = await buildCheckContext(db, "inv_subject");
}, 30000);

afterAll(async () => {
  await db?.$client.close();
});

describe("as-of check context", () => {
  it("is unchanged when later voids, credit notes, receipts, payments and fundings arrive", () => {
    expect(afterFuture).toEqual(beforeFuture);
    expect(runChecks(afterFuture.invoice, afterFuture)).toEqual(
      runChecks(beforeFuture.invoice, beforeFuture),
    );
    expect(JSON.parse(JSON.stringify(afterFuture))).toEqual(afterFuture);
  });
  it("uses the latest status on or before submission", () => {
    expect(afterFuture.ledgerEntry?.status).toBe("AUTHORISED");
    expect(
      afterFuture.otherInvoices.find((invoice) => invoice.id === "inv_original")
        ?.ledgerStatus,
    ).toBe("VOIDED");
  });
  it("includes credit notes on submission day, never later notes", () => {
    expect(afterFuture.ledgerEntry?.creditNotes.map((note) => note.id)).toEqual(
      ["cn_before", "cn_today"],
    );
  });
  // Malformed cross-client links now fail closed; dedicated receipt reconciliation tests cover them.
  it("uses only prior allocated receipts from the same client", () => {
    expect(
      afterFuture.receiptAllocations.map(
        (receipt) => receipt.bankTransactionId,
      ),
    ).toEqual(["bank_before"]);
    expect(afterFuture.receiptAllocations[0].amountCents).toBe(5000);
    expect(
      runChecks(afterFuture.invoice, afterFuture).map(
        (finding) => finding.checkId,
      ),
    ).not.toContain("ALREADY_PAID");
  });
  it("uses a 365-day inclusive lower bound and exclusive submission date for payments", () => {
    expect(afterFuture.debtorPayments.map((payment) => payment.id)).toEqual([
      "pay_boundary",
      "pay_before",
    ]);
    expect(afterFuture.priorPayment?.id).toBe("pay_before");
  });
  it("retains lifetime history for NEW_DEBTOR outside the slow-payer window", async () => {
    const ctx = await buildCheckContext(db, "inv_funded");
    expect(ctx.debtorPayments).toEqual([]);
    expect(ctx.priorPayment?.id).toBe("pay_old_diverse");
    expect(
      runChecks(ctx.invoice, ctx).map((finding) => finding.checkId),
    ).not.toContain("NEW_DEBTOR");
  });
  it("keeps same-day submissions but excludes self, future batches and other clients", () => {
    const ids = afterFuture.otherInvoices.map((invoice) => invoice.id);
    expect(ids).toContain("inv_late_ledger");
    expect(ids).not.toContain("inv_subject");
    expect(ids).not.toContain("inv_future");
    expect(ids).not.toContain("inv_foreign");
    expect(afterFuture.batchInvoices.map((invoice) => invoice.id)).toEqual([
      "inv_recorded_today",
      "inv_subject",
    ]);
  });
  it("excludes a voided original only when superseded by the subject", () => {
    expect(afterFuture.supersededLedgerEntryIds).toEqual(["led_original"]);
    expect(
      runChecks(afterFuture.invoice, afterFuture).map(
        (finding) => finding.checkId,
      ),
    ).not.toContain("DUP");
  });
  it("hides a late-recorded ledger and its backdated status and notes", async () => {
    const ctx = await buildCheckContext(db, "inv_late_ledger");
    expect(ctx.ledgerEntry).toBeNull();
    expect(ctx.receiptAllocations).toEqual([]);
    expect(
      afterFuture.otherInvoices.find(
        (invoice) => invoice.id === "inv_late_ledger",
      ),
    ).toMatchObject({ ledgerEntryId: null, ledgerStatus: null });
  });
  it("includes ledger entries recorded on submission day and leaves unknown status null", async () => {
    const ctx = await buildCheckContext(db, "inv_recorded_today");
    expect(ctx.ledgerEntry).toMatchObject({
      id: "led_recorded_today",
      recordedDate: "2026-10-23",
      status: null,
    });
  });
  it("counts full face value while exposure remains, including same-day funding and adjustments", () => {
    const funded = afterFuture.outstandingFaceValueByDebtor.flatMap(
      (debtor) => debtor.invoices,
    );
    expect(funded.map((invoice) => invoice.fundingId).sort()).toEqual([
      "fund_partial",
      "fund_subject",
    ]);
    expect(
      funded.find((invoice) => invoice.fundingId === "fund_partial"),
    ).toMatchObject({
      amountCents: 100000,
      outstandingCents: 50000,
      adjustments: [{ id: "adj_partial" }],
    });
    expect(
      afterFuture.outstandingFaceValueByDebtor.find(
        (debtor) => debtor.debtorId === "dbt_diverse",
      )?.amountCents,
    ).toBe(100000);
  });
  it("rejects a missing invoice", async () => {
    await expect(buildCheckContext(db, "inv_missing")).rejects.toThrow(
      "Invoice context not found",
    );
  });
  it("rejects conflicting latest statuses without inventing an intra-day ordering", async () => {
    await db.insert(ledgerStatusEvents).values([
      {
        ledgerEntryId: "led_foreign",
        status: "PAID",
        effectiveDate: "2026-10-01",
      },
    ]);
    await expect(buildCheckContext(db, "inv_foreign")).rejects.toThrow(
      "Ambiguous ledger status",
    );
  });
});
