import type { CheckContext, Finding, Invoice } from "@/lib/checks/types";

export function futureDated(
  invoice: Invoice,
  ctx: CheckContext,
): Finding | null {
  if (invoice.issueDate <= ctx.submittedDate) return null;
  return {
    checkId: "FUTURE_DATED",
    severity: "HIGH",
    details: { issueDate: invoice.issueDate, submittedDate: ctx.submittedDate },
    evidenceIds: [invoice.id],
  };
}
