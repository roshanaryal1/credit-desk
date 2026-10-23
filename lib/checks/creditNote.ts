import { CHECK_CONFIG } from "@/lib/checks/config";
import type { CheckContext, Finding, Invoice } from "@/lib/checks/types";

export function creditNote(
  invoice: Invoice,
  ctx: CheckContext,
): Finding | null {
  const ledger = ctx.ledgerEntry;
  if (!ledger || ledger.creditNotes.length === 0) return null;
  const creditedCents = ledger.creditNotes.reduce(
    (sum, note) => sum + note.amountCents,
    0,
  );
  return {
    checkId: "CREDIT_NOTE",
    severity:
      creditedCents * 10000 >
      invoice.amountCents * CHECK_CONFIG.creditNoteHighShareBps
        ? "HIGH"
        : "MEDIUM",
    details: { creditedCents, amountCents: invoice.amountCents },
    evidenceIds: [
      invoice.id,
      ledger.id,
      ...ledger.creditNotes.map((note) => note.id),
    ],
  };
}
