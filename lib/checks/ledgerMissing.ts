import type { CheckContext, Finding, Invoice } from "@/lib/checks/types";

export function ledgerMissing(
  invoice: Invoice,
  ctx: CheckContext,
): Finding | null {
  if (ctx.ledgerEntry !== null) return null;
  return {
    checkId: "LEDGER_MISSING",
    severity: "HIGH",
    details: {
      clientId: invoice.clientId,
      invoiceNumber: invoice.invoiceNumber,
      submittedDate: ctx.submittedDate,
    },
    evidenceIds: [invoice.id],
  };
}
