import { describe, expect, it } from "vitest";
import {
  providerMoneyNZD,
  SandboxBankFeed,
  SandboxLedgerSource,
} from "@/lib/data/provider-contract";

describe("offline provider contract fixtures", () => {
  it("parses NZD cents without float rounding or format ambiguity", () => {
    expect(providerMoneyNZD("12.34")).toBe(1234);
    expect(providerMoneyNZD("0.01")).toBe(1);
    expect(() => providerMoneyNZD("12.345")).toThrow(/decimal/);
    expect(() => providerMoneyNZD("-2.00")).toThrow(/decimal/);
    expect(() => providerMoneyNZD("9999999999999999999.00")).toThrow(
      /overflow/,
    );
  });
  it("maps effective-date versions and excludes future credit notes", async () => {
    const ledger = new SandboxLedgerSource([
      {
        clientId: "c1",
        externalId: "inv1",
        invoiceNumber: "NZ-1",
        debtorExternalId: "d1",
        issueDate: "2026-10-01",
        effectiveDate: "2026-10-01",
        amountNZD: "100.00",
        status: "AUTHORISED",
        creditNotes: [],
      },
      {
        clientId: "c1",
        externalId: "inv1",
        invoiceNumber: "NZ-1",
        debtorExternalId: "d1",
        issueDate: "2026-10-01",
        effectiveDate: "2026-10-20",
        amountNZD: "100.00",
        status: "PAID",
        creditNotes: [
          { externalId: "cn1", date: "2026-10-21", amountNZD: "5.00" },
        ],
      },
      {
        clientId: "other",
        externalId: "inv2",
        invoiceNumber: "NZ-2",
        debtorExternalId: "d2",
        issueDate: "2026-10-01",
        effectiveDate: "2026-10-01",
        amountNZD: "999.00",
        status: "AUTHORISED",
        creditNotes: [],
      },
    ]);
    const early = await ledger.invoices("c1", "2026-10-10");
    expect(early).toHaveLength(1);
    expect(early[0]?.status).toBe("AUTHORISED");
    const late = await ledger.invoices("c1", "2026-10-20");
    expect(late[0]?.status).toBe("PAID");
    expect(late[0]?.creditNotes).toHaveLength(0);
    expect(
      (await ledger.invoices("c1", "2026-10-22"))[0]?.creditNotes[0]
        ?.amountCents,
    ).toBe(500);
  });
  it("maps only positive bank credits in the selected client/date window", async () => {
    const feed = new SandboxBankFeed([
      {
        clientId: "c1",
        externalId: "a",
        date: "2026-10-10",
        amountNZD: "5.40",
        direction: "CREDIT",
        counterpartyName: "payer",
        reference: "x",
      },
      {
        clientId: "c1",
        externalId: "b",
        date: "2026-10-12",
        amountNZD: "7.10",
        direction: "DEBIT",
        counterpartyName: "bank",
        reference: "fee",
      },
      {
        clientId: "c2",
        externalId: "c",
        date: "2026-10-10",
        amountNZD: "999.00",
        direction: "CREDIT",
        counterpartyName: "other",
        reference: "secret",
      },
    ]);
    const rows = await feed.receipts("c1", "2026-10-01", "2026-10-31");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amountCents).toBe(540);
    await expect(
      feed.receipts("c1", "2026-10-31", "2026-10-01"),
    ).rejects.toThrow(/range/);
  });
});
