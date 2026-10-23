import { CHECK_CONFIG } from "@/lib/checks/config";
import type { CheckContext, Finding, Invoice } from "@/lib/checks/types";
import { daysBetween } from "@/lib/dates";

export function newDebtor(invoice: Invoice, ctx: CheckContext): Finding | null {
  const daysKnown = daysBetween(ctx.debtor.firstSeenDate, ctx.submittedDate);
  const hasPaymentHistory = ctx.priorPayment !== null;
  if (daysKnown >= CHECK_CONFIG.newDebtorDays && hasPaymentHistory) return null;
  return {
    checkId: "NEW_DEBTOR",
    severity: "MEDIUM",
    details: {
      daysKnown,
      firstSeenDate: ctx.debtor.firstSeenDate,
      hasPaymentHistory,
    },
    evidenceIds: [
      invoice.id,
      ctx.debtor.id,
      ...(ctx.priorPayment ? [ctx.priorPayment.id] : []),
    ],
  };
}
