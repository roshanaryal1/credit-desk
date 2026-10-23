import type { CheckContext, Finding, Invoice } from "@/lib/checks/types";

export function voided(invoice: Invoice, ctx: CheckContext): Finding | null {
  if (ctx.ledgerEntry?.status !== "VOIDED") return null;
  return {
    checkId: "VOIDED",
    severity: "HIGH",
    details: {
      status: ctx.ledgerEntry.status,
      submittedDate: ctx.submittedDate,
    },
    evidenceIds: [invoice.id, ctx.ledgerEntry.id],
  };
}
