import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

function validateDate(asOf: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
    Number.isNaN(Date.parse(`${asOf}T00:00:00Z`)) ||
    new Date(`${asOf}T00:00:00Z`).toISOString().slice(0, 10) !== asOf
  ) throw new Error("A valid as-of business date is required");
}

/**
 * Client-scoped read model using only synthetic lender records.
 * Facility terms are current (not historical); dated invoices/fundings respect
 * the as-of cutoff. Never call these raw DB queries for real multi-tenant data
 * without the G10 verified-identity authorization boundary.
 */
export async function getClientDossier(db: Db, clientId: string, asOf: string) {
  validateDate(asOf);
  if (!clientId.trim()) return null;
  const [client] = await db.select().from(t.clients).where(eq(t.clients.id, clientId)).limit(1);
  if (!client) return null;

  const [batches, invoices, debtors, incidents] = await Promise.all([
    db.select().from(t.batches)
      .where(and(eq(t.batches.clientId, clientId), lte(t.batches.submittedDate, asOf)))
      .orderBy(desc(t.batches.submittedDate), asc(t.batches.id)),
    db.select().from(t.invoices)
      .where(eq(t.invoices.clientId, clientId)),
    db.select().from(t.debtors)
      .where(eq(t.debtors.clientId, clientId))
      .orderBy(asc(t.debtors.name)),
    db.select().from(t.incidents)
      .where(and(eq(t.incidents.clientId, clientId), lte(t.incidents.firstDetectedDate, asOf)))
      .orderBy(desc(t.incidents.firstDetectedDate), asc(t.incidents.id)),
  ]);
  const batchIds = new Set(batches.map((b) => b.id));
  const visibleInvoices = invoices.filter((invoice) => batchIds.has(invoice.batchId));
  const invoiceIds = visibleInvoices.map((invoice) => invoice.id);
  const fundings = invoiceIds.length
    ? await db.select().from(t.fundings)
        .where(and(inArray(t.fundings.invoiceId, invoiceIds), lte(t.fundings.fundedDate, asOf)))
    : [];
  const fundingIds = fundings.map((funding) => funding.id);
  const adjustments = fundingIds.length
    ? await db.select().from(t.fundingAdjustments)
        .where(and(inArray(t.fundingAdjustments.fundingId, fundingIds), lte(t.fundingAdjustments.date, asOf)))
    : [];

  const adjusted = new Map<string, number>();
  for (const a of adjustments) {
    adjusted.set(a.fundingId, (adjusted.get(a.fundingId) ?? 0) + a.amountCents);
  }
  const outstandingByInvoice = new Map<string, number>();
  for (const funding of fundings) {
    const outstanding = funding.advanceCents - (adjusted.get(funding.id) ?? 0);
    if (outstanding < 0) {
      throw new Error(`Funding ${funding.id} has adjustments exceeding advances`);
    }
    outstandingByInvoice.set(funding.invoiceId, outstanding);
  }
  const inUseCents = [...outstandingByInvoice.values()].reduce((total, cents) => total + cents, 0);
  const submittedFaceCents = visibleInvoices.reduce((total, row) => total + row.amountCents, 0);
  const byDebtor = new Map(debtors.map((d) => [
    d.id, { id: d.id, name: d.name, submittedFaceCents: 0, fundedOutstandingCents: 0, invoiceCount: 0 },
  ]));
  for (const invoice of visibleInvoices) {
    const row = byDebtor.get(invoice.debtorId);
    if (!row) throw new Error(`Unknown client debtor ${invoice.debtorId}`);
    row.submittedFaceCents += invoice.amountCents;
    row.fundedOutstandingCents += outstandingByInvoice.get(invoice.id) ?? 0;
    row.invoiceCount++;
  }
  const batchInfo = batches.map((b) => {
    const rows = visibleInvoices.filter((i) => i.batchId === b.id);
    return {
      id: b.id,
      submittedDate: b.submittedDate,
      status: b.status,
      invoiceCount: rows.length,
      faceCents: rows.reduce((total, item) => total + item.amountCents, 0),
    };
  });
  const headroomCents = Math.max(0, client.facilityLimitCents - inUseCents);
  return {
    asOf,
    client,
    submittedInvoiceCount: visibleInvoices.length,
    submittedFaceCents,
    inUseCents,
    commitmentHeadroomCents: headroomCents,
    batches: batchInfo,
    debtors: [...byDebtor.values()].sort((a,b) =>
      b.fundedOutstandingCents - a.fundedOutstandingCents || a.name.localeCompare(b.name)),
    incidents: incidents.map((i) => ({
      id: i.id,
      ruleId: i.ruleId,
      severity: i.severity,
      firstDetectedDate: i.firstDetectedDate,
    })),
  };
}
