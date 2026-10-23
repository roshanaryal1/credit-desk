import { inArray } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { businessDate, money } from "@/lib/format";

// Resolves cited record ids to short, human-readable evidence rows.

export interface EvidenceRow {
  id: string;
  kind: string;
  facts: string[];
}

export async function resolveEvidence(
  ids: string[],
): Promise<Map<string, EvidenceRow>> {
  const db = await getDb();
  const out = new Map<string, EvidenceRow>();
  const want = [...new Set(ids)];
  if (want.length === 0) return out;
  const by = <T>(rows: T[], f: (r: T) => EvidenceRow) =>
    rows.forEach((r) => {
      const e = f(r);
      out.set(e.id, e);
    });
  by(
    await db.select().from(t.invoices).where(inArray(t.invoices.id, want)),
    (r) => ({
      id: r.id,
      kind: "Invoice",
      facts: [
        r.invoiceNumber,
        money(r.amountCents),
        `issued ${businessDate(r.issueDate)}`,
        `due ${businessDate(r.dueDate)}`,
      ],
    }),
  );
  by(
    await db
      .select()
      .from(t.ledgerEntries)
      .where(inArray(t.ledgerEntries.id, want)),
    (r) => ({
      id: r.id,
      kind: "Ledger entry",
      facts: [
        r.invoiceNumber,
        money(r.amountCents),
        `issued ${businessDate(r.issueDate)}`,
      ],
    }),
  );
  by(
    await db
      .select()
      .from(t.creditNotes)
      .where(inArray(t.creditNotes.id, want)),
    (r) => ({
      id: r.id,
      kind: "Credit note",
      facts: [money(r.amountCents), businessDate(r.date)],
    }),
  );
  by(
    await db
      .select()
      .from(t.bankTransactions)
      .where(inArray(t.bankTransactions.id, want)),
    (r) => ({
      id: r.id,
      kind: "Bank receipt",
      facts: [
        money(r.amountCents),
        businessDate(r.date),
        r.counterpartyName,
        `ref ${r.reference}`,
      ],
    }),
  );
  by(
    await db
      .select()
      .from(t.debtorPayments)
      .where(inArray(t.debtorPayments.id, want)),
    (r) => ({
      id: r.id,
      kind: "Debtor payment",
      facts: [
        r.invoiceNumber,
        money(r.amountCents),
        `paid ${businessDate(r.paidDate)}`,
      ],
    }),
  );
  by(
    await db.select().from(t.debtors).where(inArray(t.debtors.id, want)),
    (r) => ({
      id: r.id,
      kind: "Debtor",
      facts: [r.name, `first seen ${businessDate(r.firstSeenDate)}`],
    }),
  );
  by(
    await db.select().from(t.findings).where(inArray(t.findings.id, want)),
    (r) => ({
      id: r.id,
      kind: "Check finding",
      facts: [r.checkId, r.severity.toLowerCase()],
    }),
  );
  by(
    await db.select().from(t.fundings).where(inArray(t.fundings.id, want)),
    (r) => ({
      id: r.id,
      kind: "Funding",
      facts: [money(r.advanceCents), `funded ${businessDate(r.fundedDate)}`],
    }),
  );
  by(
    await db
      .select()
      .from(t.fundingAdjustments)
      .where(inArray(t.fundingAdjustments.id, want)),
    (r) => ({
      id: r.id,
      kind: "Repayment",
      facts: [r.kind.toLowerCase(), money(r.amountCents), businessDate(r.date)],
    }),
  );
  return out;
}
