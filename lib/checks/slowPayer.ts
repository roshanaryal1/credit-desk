import { CHECK_CONFIG } from "@/lib/checks/config";
import type { CheckContext, Finding, Invoice } from "@/lib/checks/types";
import { daysBetween } from "@/lib/dates";

export function slowPayer(invoice: Invoice, ctx: CheckContext): Finding | null {
  const payments = ctx.debtorPayments;
  if (payments.length < CHECK_CONFIG.slowPayerMinPayments) return null;
  const totalDays = payments.reduce(
    (sum, payment) => sum + daysBetween(payment.issueDate, payment.paidDate),
    0,
  );
  const thresholdDays =
    ctx.client.paymentTermsDays + CHECK_CONFIG.slowPayerGraceDays;
  if (totalDays <= thresholdDays * payments.length) return null;
  return {
    checkId: "SLOW_PAYER",
    severity: "MEDIUM",
    details: {
      meanDaysToPay: totalDays / payments.length,
      paymentCount: payments.length,
      thresholdDays,
    },
    evidenceIds: [
      invoice.id,
      ctx.client.id,
      ...payments.map((payment) => payment.id),
    ],
  };
}
