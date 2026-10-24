import { asc, eq } from "drizzle-orm";

import { CONFIG_VERSION } from "@/lib/checks/config";
import { buildCheckContext } from "@/lib/checks/context";
import { runChecks } from "@/lib/checks/index";
import type { Finding } from "@/lib/checks/types";
import type { Db } from "@/lib/db/client";
import { batches, findings, invoices } from "@/lib/db/schema";

export interface InvoiceResult {
  invoiceId: string;
  findings: Finding[];
}

/** Runs every check on every invoice in a batch. Pure reads; no writes. */
export async function evaluateBatch(
  db: Db,
  batchId: string,
): Promise<InvoiceResult[]> {
  const rows = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.batchId, batchId))
    .orderBy(asc(invoices.id));
  const results: InvoiceResult[] = [];
  for (const { id } of rows) {
    const ctx = await buildCheckContext(db, id);
    results.push({ invoiceId: id, findings: runChecks(ctx.invoice, ctx) });
  }
  return results;
}

/**
 * Evaluates a batch and stores its findings under the current CONFIG_VERSION.
 * Idempotent: re-running for the same config version inserts nothing new.
 */
export async function runBatch(
  db: Db,
  batchId: string,
): Promise<InvoiceResult[]> {
  const results = await evaluateBatch(db, batchId);
  const rows = results.flatMap((r) =>
    r.findings.map((f) => ({
      id: `fdg_${r.invoiceId}_${f.checkId}_${CONFIG_VERSION}`,
      invoiceId: r.invoiceId,
      checkId: f.checkId,
      severity: f.severity,
      details: { ...f.details, evidenceIds: f.evidenceIds },
      configVersion: CONFIG_VERSION,
    })),
  );
  if (rows.length > 0) {
    await db.insert(findings).values(rows).onConflictDoNothing();
  }
  return results;
}

/** Runs every batch in submission order. */
export async function runAllBatches(db: Db): Promise<InvoiceResult[]> {
  const all = await db
    .select({ id: batches.id })
    .from(batches)
    .orderBy(asc(batches.submittedDate), asc(batches.id));
  const results: InvoiceResult[] = [];
  for (const b of all) results.push(...(await runBatch(db, b.id)));
  return results;
}
