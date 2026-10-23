import "server-only";

import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";

import { CONFIG_VERSION } from "@/lib/checks/config";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { DEMO_TODAY } from "@/lib/demo";

import { fundableCents } from "./money";

// Read models for the UI. Server only: these query the database directly.

export type InvoiceStatus = "CLEAR" | "FLAGGED" | "HIGH_RISK";

export async function fundsInUseByClient(asOf = DEMO_TODAY) {
  const db = await getDb();
  const rows = await db
    .select({
      clientId: t.invoices.clientId,
      advance: t.fundings.advanceCents,
      repaid: sql<number>`coalesce((select sum(${t.fundingAdjustments.amountCents}) from ${t.fundingAdjustments} where ${t.fundingAdjustments.fundingId} = ${t.fundings.id} and ${t.fundingAdjustments.date} <= ${asOf}), 0)`,
    })
    .from(t.fundings)
    .innerJoin(t.invoices, eq(t.fundings.invoiceId, t.invoices.id))
    .where(lte(t.fundings.fundedDate, asOf));
  const out = new Map<string, number>();
  for (const r of rows) {
    const outstanding = r.advance - Number(r.repaid);
    if (outstanding > 0)
      out.set(r.clientId, (out.get(r.clientId) ?? 0) + outstanding);
  }
  return out;
}

export async function listClients() {
  const db = await getDb();
  const clients = await db
    .select()
    .from(t.clients)
    .orderBy(asc(t.clients.name));
  const inUse = await fundsInUseByClient();
  return clients.map((c) => ({ ...c, fundsInUseCents: inUse.get(c.id) ?? 0 }));
}

function statusOf(severities: string[]): InvoiceStatus {
  if (severities.includes("HIGH")) return "HIGH_RISK";
  return severities.length > 0 ? "FLAGGED" : "CLEAR";
}

export async function listBatches() {
  const db = await getDb();
  const batches = await db
    .select({ batch: t.batches, clientName: t.clients.name })
    .from(t.batches)
    .innerJoin(t.clients, eq(t.batches.clientId, t.clients.id))
    .orderBy(
      sql`${t.batches.status} = 'PENDING' desc`,
      sql`${t.batches.submittedDate} desc`,
    );
  const invoices = await db.select().from(t.invoices);
  const findings = await db
    .select({ invoiceId: t.findings.invoiceId, severity: t.findings.severity })
    .from(t.findings)
    .where(eq(t.findings.configVersion, CONFIG_VERSION));
  const sevByInvoice = new Map<string, string[]>();
  for (const f of findings)
    sevByInvoice.set(f.invoiceId, [
      ...(sevByInvoice.get(f.invoiceId) ?? []),
      f.severity,
    ]);
  return batches.map(({ batch, clientName }) => {
    const mine = invoices.filter((i) => i.batchId === batch.id);
    const statuses = mine.map((i) => statusOf(sevByInvoice.get(i.id) ?? []));
    return {
      ...batch,
      clientName,
      invoiceCount: mine.length,
      faceCents: mine.reduce((s, i) => s + i.amountCents, 0),
      flagged: statuses.filter((s) => s === "FLAGGED").length,
      highRisk: statuses.filter((s) => s === "HIGH_RISK").length,
    };
  });
}

export async function getBatch(batchId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ batch: t.batches, client: t.clients })
    .from(t.batches)
    .innerJoin(t.clients, eq(t.batches.clientId, t.clients.id))
    .where(eq(t.batches.id, batchId));
  if (!row) return null;
  const invoices = await db
    .select({ invoice: t.invoices, debtorName: t.debtors.name })
    .from(t.invoices)
    .innerJoin(t.debtors, eq(t.invoices.debtorId, t.debtors.id))
    .where(eq(t.invoices.batchId, batchId))
    .orderBy(asc(t.invoices.invoiceNumber));
  const ids = invoices.map((i) => i.invoice.id);
  const findings = ids.length
    ? await db
        .select()
        .from(t.findings)
        .where(
          and(
            inArray(t.findings.invoiceId, ids),
            eq(t.findings.configVersion, CONFIG_VERSION),
          ),
        )
    : [];
  const decisions = ids.length
    ? await db
        .select()
        .from(t.decisions)
        .where(inArray(t.decisions.invoiceId, ids))
        .orderBy(asc(t.decisions.decidedAt))
    : [];
  const latestDecision = new Map<string, (typeof decisions)[number]>();
  for (const d of decisions) latestDecision.set(d.invoiceId, d);

  const rows = invoices.map(({ invoice, debtorName }) => {
    const mine = findings.filter((f) => f.invoiceId === invoice.id);
    return {
      ...invoice,
      debtorName,
      findings: mine.map((f) => ({ checkId: f.checkId, severity: f.severity })),
      status: statusOf(mine.map((f) => f.severity)),
      decision: latestDecision.get(invoice.id)?.decision ?? null,
    };
  });

  const faceCents = rows.reduce((s, r) => s + r.amountCents, 0);
  const flaggedCents = rows
    .filter((r) => r.status !== "CLEAR")
    .reduce((s, r) => s + r.amountCents, 0);
  const inUse = (await fundsInUseByClient()).get(row.client.id) ?? 0;
  const fundable = fundableCents({
    approvedAmountsCents: rows
      .filter((r) => r.decision === "APPROVE")
      .map((r) => r.amountCents),
    advanceRateBps: row.client.advanceRateBps,
    facilityLimitCents: row.client.facilityLimitCents,
    fundsInUseCents: inUse,
  });
  // Clean invoices at the advance rate: what this batch could fund if approved.
  const potential = fundableCents({
    approvedAmountsCents: rows
      .filter((r) => r.status === "CLEAR")
      .map((r) => r.amountCents),
    advanceRateBps: row.client.advanceRateBps,
    facilityLimitCents: row.client.facilityLimitCents,
    fundsInUseCents: inUse,
  });

  const byDebtor = new Map<string, { name: string; cents: number }>();
  for (const r of rows) {
    const cur = byDebtor.get(r.debtorId) ?? { name: r.debtorName, cents: 0 };
    cur.cents += r.amountCents;
    byDebtor.set(r.debtorId, cur);
  }
  const concentration = [...byDebtor.entries()]
    .map(([debtorId, v]) => ({
      debtorId,
      ...v,
      shareBps: faceCents ? Math.round((v.cents * 10_000) / faceCents) : 0,
    }))
    .sort((a, b) => b.cents - a.cents);

  return {
    batch: row.batch,
    client: row.client,
    invoices: rows,
    summary: {
      faceCents,
      flaggedCents,
      fundsInUseCents: inUse,
      fundableCents: fundable.capped,
      potentialFundableCents: potential.capped,
      headroomCents: fundable.headroom,
      approvedCount: rows.filter((r) => r.decision === "APPROVE").length,
      decidedCount: rows.filter((r) => r.decision !== null).length,
    },
    concentration,
  };
}
