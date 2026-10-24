import type { CheckContext, Finding, Invoice } from "@/lib/checks/types";

export function ledgerMismatch(
  invoice: Invoice,
  ctx: CheckContext,
): Finding | null {
  const ledger = ctx.ledgerEntry;
  if (!ledger) return null;
  const differences: Record<
    string,
    { submitted: string | number; ledger: string | number }
  > = {};
  for (const field of ["amountCents", "debtorId", "issueDate"] as const) {
    if (invoice[field] !== ledger[field]) {
      differences[field] = { submitted: invoice[field], ledger: ledger[field] };
    }
  }
  if (Object.keys(differences).length === 0) return null;
  return {
    checkId: "LEDGER_MISMATCH",
    severity: "HIGH",
    details: { differences },
    evidenceIds: [invoice.id, ledger.id],
  };
}
