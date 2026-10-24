import { CHECK_CONFIG } from "@/lib/checks/config";
import type { CheckContext, Finding, Invoice } from "@/lib/checks/types";
import { daysBetween } from "@/lib/dates";

export function dup(invoice: Invoice, ctx: CheckContext): Finding | null {
  const matches = ctx.otherInvoices.filter((other) => {
    if (other.id === invoice.id || other.clientId !== invoice.clientId)
      return false;
    if (
      other.ledgerEntryId !== null &&
      other.ledgerStatus === "VOIDED" &&
      ctx.supersededLedgerEntryIds.includes(other.ledgerEntryId)
    )
      return false;
    return (
      other.invoiceNumber === invoice.invoiceNumber ||
      (other.debtorId === invoice.debtorId &&
        other.amountCents === invoice.amountCents &&
        Math.abs(daysBetween(other.issueDate, invoice.issueDate)) <=
          CHECK_CONFIG.duplicateWindowDays)
    );
  });
  if (matches.length === 0) return null;
  return {
    checkId: "DUP",
    severity: "HIGH",
    details: { matchingInvoiceIds: matches.map((match) => match.id) },
    evidenceIds: [invoice.id, ...matches.map((match) => match.id)],
  };
}
