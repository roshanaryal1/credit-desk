import "server-only";

import { getDb } from "@/lib/db/client";
import { loadReviewEvidence } from "@/lib/trust/review-evidence";
import * as t from "@/lib/db/schema";
import { businessDate, money } from "@/lib/format";

// Resolves cited record ids to short, human-readable evidence rows.

export interface EvidenceRow {
  id: string;
  kind: string;
  facts: string[];
}

export function presentReviewEvidence(
  records: Record<string, Record<string, unknown>>,
): Map<string, EvidenceRow> {
  const out = new Map<string, EvidenceRow>();
  const rows = Object.values(records);
  const by = <T>(rows: T[], f: (r: T) => EvidenceRow) =>
    rows.forEach((r) => {
      const e = f(r);
      out.set(e.id, e);
    });
  by(
    rows.filter((r) =>
      Object.hasOwn(r, "batchId"),
    ) as unknown as (typeof t.invoices.$inferSelect)[],
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
    rows.filter((r) =>
      Object.hasOwn(r, "recordedDate"),
    ) as unknown as (typeof t.ledgerEntries.$inferSelect)[],
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
    rows.filter(
      (r) => Object.hasOwn(r, "ledgerEntryId") && !Object.hasOwn(r, "paidDate"),
    ) as unknown as (typeof t.creditNotes.$inferSelect)[],
    (r) => ({
      id: r.id,
      kind: "Credit note",
      facts: [money(r.amountCents), businessDate(r.date)],
    }),
  );
  by(
    rows.filter((r) =>
      Object.hasOwn(r, "counterpartyName"),
    ) as unknown as (typeof t.bankTransactions.$inferSelect)[],
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
    rows.filter((r) =>
      Object.hasOwn(r, "paidDate"),
    ) as unknown as (typeof t.debtorPayments.$inferSelect)[],
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
    rows.filter((r) =>
      Object.hasOwn(r, "firstSeenDate"),
    ) as unknown as (typeof t.debtors.$inferSelect)[],
    (r) => ({
      id: r.id,
      kind: "Debtor",
      facts: [r.name, `first seen ${businessDate(r.firstSeenDate)}`],
    }),
  );
  by(
    rows.filter((r) =>
      Object.hasOwn(r, "checkId"),
    ) as unknown as (typeof t.findings.$inferSelect)[],
    (r) => ({
      id: r.id,
      kind: "Check finding",
      facts: [r.checkId, r.severity.toLowerCase()],
    }),
  );
  by(
    rows.filter((r) =>
      Object.hasOwn(r, "advanceCents"),
    ) as unknown as (typeof t.fundings.$inferSelect)[],
    (r) => ({
      id: r.id,
      kind: "Funding",
      facts: [money(r.advanceCents), `funded ${businessDate(r.fundedDate)}`],
    }),
  );
  by(
    rows.filter((r) =>
      Object.hasOwn(r, "kind"),
    ) as unknown as (typeof t.fundingAdjustments.$inferSelect)[],
    (r) => ({
      id: r.id,
      kind: "Repayment",
      facts: [r.kind.toLowerCase(), money(r.amountCents), businessDate(r.date)],
    }),
  );
  return out;
}

/** Render only verified captured records, never substitute a current table row. */
export function resolveCapturedEvidence(
  records: import("@/lib/agent/evidence").EvidenceRecord[],
): Map<string, EvidenceRow> {
  return new Map(
    records.map((record) => [
      record.id,
      {
        id: record.id,
        kind: `Captured ${String(record.type).replaceAll("_", " ")}`,
        facts: Object.entries(record)
          .filter(([key]) => !["id", "clientId", "type"].includes(key))
          .map(
            ([key, value]) =>
              `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
          ),
      },
    ]),
  );
}

/** Outside the invoice decision flow, require an explicit client boundary. */
export async function resolveEvidence(
  ids: string[],
  clientId: string,
): Promise<Map<string, EvidenceRow>> {
  return presentReviewEvidence(
    await loadReviewEvidence(await getDb(), ids, clientId),
  );
}
