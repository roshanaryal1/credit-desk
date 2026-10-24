import type {
  BankFeedSource,
  BankReceipt,
  LedgerInvoice,
  LedgerSource,
} from "./types";

/**
 * Offline, deterministic provider-shaped contract fixtures. This is NOT a
 * Xero or Akahu network connector and holds no OAuth tokens or bank accounts.
 * Real adapters must use consent-scoped data pipelines from #100 and #109.
 */
export interface SandboxLedgerVersion {
  clientId: string;
  externalId: string;
  invoiceNumber: string;
  debtorExternalId: string;
  amountNZD: string;
  issueDate: string;
  effectiveDate: string;
  status: LedgerInvoice["status"];
  creditNotes: {
    externalId: string;
    date: string;
    amountNZD: string;
  }[];
}

export interface SandboxBankEntry {
  clientId: string;
  externalId: string;
  date: string;
  amountNZD: string;
  direction: "CREDIT" | "DEBIT";
  counterpartyName: string;
  reference: string;
}

function date(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Invalid provider date");
  const millis = Date.parse(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(millis) ||
    new Date(millis).toISOString().slice(0, 10) !== value
  )
    throw new Error("Invalid provider date");
  return value;
}

/** Reject floating-point money, ambiguous separators, negatives and overflow. */
export function providerMoneyNZD(value: string): number {
  if (!/^(?:0|[1-9]\d*)\.\d{2}$/.test(value))
    throw new Error(
      "Provider money requires nonnegative NZD decimal with two digits",
    );
  const [whole, fraction] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction);
  if (!Number.isSafeInteger(cents))
    throw new Error("Provider monetary overflow");
  return cents;
}

export class SandboxLedgerSource implements LedgerSource {
  readonly name = "sandbox-ledger-contract";
  constructor(private readonly versions: SandboxLedgerVersion[]) {}

  async invoices(clientId: string, asOf: string): Promise<LedgerInvoice[]> {
    date(asOf);
    const latest = new Map<string, SandboxLedgerVersion>();
    const all = this.versions
      .filter((r) => r.clientId === clientId)
      .sort(
        (a, b) =>
          a.effectiveDate.localeCompare(b.effectiveDate) ||
          a.externalId.localeCompare(b.externalId),
      );
    for (const version of all) {
      date(version.issueDate);
      date(version.effectiveDate);
      providerMoneyNZD(version.amountNZD);
      if (version.effectiveDate > asOf) continue;
      if (!["AUTHORISED", "PAID", "VOIDED"].includes(version.status))
        throw new Error("Unknown ledger status");
      if (
        !version.externalId.trim() ||
        !version.invoiceNumber.trim() ||
        !version.debtorExternalId.trim()
      )
        throw new Error("Missing invoice identity");
      latest.set(version.externalId, version);
    }
    return [...latest.values()]
      .sort((a, b) => a.externalId.localeCompare(b.externalId))
      .map((v) => ({
        externalId: v.externalId,
        invoiceNumber: v.invoiceNumber,
        debtorExternalId: v.debtorExternalId,
        amountCents: providerMoneyNZD(v.amountNZD),
        issueDate: v.issueDate,
        status: v.status,
        creditNotes: v.creditNotes
          .filter((note) => date(note.date) <= asOf)
          .map((note) => ({
            externalId: note.externalId,
            date: note.date,
            amountCents: providerMoneyNZD(note.amountNZD),
          })),
      }));
  }
}

export class SandboxBankFeed implements BankFeedSource {
  readonly name = "sandbox-bank-contract";
  constructor(private readonly rows: SandboxBankEntry[]) {}

  async receipts(
    clientId: string,
    from: string,
    to: string,
  ): Promise<BankReceipt[]> {
    date(from);
    date(to);
    if (from > to) throw new Error("Invalid bank date range");
    return this.rows
      .filter((r) => r.clientId === clientId)
      .filter((r) => date(r.date) >= from && date(r.date) <= to)
      .filter((r) => r.direction === "CREDIT")
      .map((r) => ({
        externalId: r.externalId,
        date: r.date,
        amountCents: providerMoneyNZD(r.amountNZD),
        counterpartyName: r.counterpartyName,
        reference: r.reference,
      }))
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.externalId.localeCompare(b.externalId),
      );
  }
}
