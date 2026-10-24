import { CHECK_CONFIG } from "@/lib/checks/config";
import type { CheckContext, Finding, Invoice } from "@/lib/checks/types";

export function alreadyPaid(
  invoice: Invoice,
  ctx: CheckContext,
): Finding | null {
  if (!ctx.ledgerEntry || ctx.receiptAllocations.length === 0) return null;
  const allocatedCents = ctx.receiptAllocations.reduce(
    (sum, receipt) => sum + receipt.amountCents,
    0,
  );
  if (
    allocatedCents * 10000 <
    invoice.amountCents * CHECK_CONFIG.alreadyPaidCoverageBps
  )
    return null;
  return {
    checkId: "ALREADY_PAID",
    severity: "HIGH",
    details: { allocatedCents, amountCents: invoice.amountCents },
    evidenceIds: [
      invoice.id,
      ctx.ledgerEntry.id,
      ...new Set(
        ctx.receiptAllocations.map((receipt) => receipt.bankTransactionId),
      ),
    ],
  };
}
