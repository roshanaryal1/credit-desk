import { CHECK_CONFIG } from "@/lib/checks/config";
import type { CheckContext, Finding, Invoice } from "@/lib/checks/types";

export function concentration(
  invoice: Invoice,
  ctx: CheckContext,
): Finding | null {
  const counted = new Map<string, { debtorId: string; amountCents: number }>();
  const evidenceIds = new Set<string>([invoice.id]);
  for (const debtor of ctx.outstandingFaceValueByDebtor) {
    for (const funded of debtor.invoices) {
      counted.set(funded.invoiceId, {
        debtorId: debtor.debtorId,
        amountCents: funded.amountCents,
      });
      // Evidence is limited to this debtor's records; totals are in details.
      if (debtor.debtorId === invoice.debtorId) {
        evidenceIds.add(funded.invoiceId);
        evidenceIds.add(funded.fundingId);
      }
    }
  }
  for (const batchInvoice of ctx.batchInvoices) {
    counted.set(batchInvoice.id, {
      debtorId: batchInvoice.debtorId,
      amountCents: batchInvoice.amountCents,
    });
    if (batchInvoice.debtorId === invoice.debtorId)
      evidenceIds.add(batchInvoice.id);
  }
  let totalCents = 0;
  let debtorCents = 0;
  for (const value of counted.values()) {
    totalCents += value.amountCents;
    if (value.debtorId === invoice.debtorId) debtorCents += value.amountCents;
  }
  if (
    totalCents === 0 ||
    debtorCents * 10000 <= totalCents * CHECK_CONFIG.concentrationBps
  )
    return null;
  return {
    checkId: "CONCENTRATION",
    severity: "MEDIUM",
    details: {
      debtorCents,
      totalCents,
      shareBps: Math.floor((debtorCents * 10000) / totalCents),
    },
    evidenceIds: [...evidenceIds],
  };
}
