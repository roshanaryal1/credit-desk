import { CHECK_CONFIG } from "@/lib/checks/config";
import type { CheckContext, Finding, Invoice } from "@/lib/checks/types";
import { daysBetween } from "@/lib/dates";

export function overAge(invoice: Invoice, ctx: CheckContext): Finding | null {
  const ageDays = daysBetween(invoice.issueDate, ctx.submittedDate);
  if (ageDays <= CHECK_CONFIG.overAgeDays) return null;
  return {
    checkId: "OVER_AGE",
    severity: "HIGH",
    details: {
      ageDays,
      issueDate: invoice.issueDate,
      submittedDate: ctx.submittedDate,
    },
    evidenceIds: [invoice.id],
  };
}
