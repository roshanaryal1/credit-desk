import { parseArgs } from "node:util";

import { count, eq, sql } from "drizzle-orm";

import { closeDb, getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import {
  REQUIRED_DEMO_TABLES,
  assessDemoReadiness,
} from "@/lib/deploy/demo-readiness";

const DEMO_BORROWER_ID = "cli_0001";

async function main() {
  const args = parseArgs({ options: { target: { type: "string" } } });
  const target = args.values.target;
  if (target !== "preview" && target !== "production") {
    throw new Error(
      "Choose an explicit --target=preview or --target=production.",
    );
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("A deliberately selected DATABASE_URL is required.");
  }
  const db = await getDb();
  const tableRows = await db.execute<{ table_name: string }>(sql`
    select table_name from information_schema.tables
    where table_schema = 'public'
  `);
  const foundTables = tableRows.rows.map((row) => row.table_name);
  const tracked = await db.execute<{ exists: boolean }>(sql`
    select to_regclass('drizzle.__drizzle_migrations') is not null as exists
  `);
  let clientCount = 0;
  let invoiceCount = 0;
  let batchCount = 0;
  let findingCount = 0;
  let pinnedClientFound = false;
  if (REQUIRED_DEMO_TABLES.every((table) => foundTables.includes(table))) {
    const [clients, invoices, batches, findings, pinned] = await Promise.all([
      db.select({ n: count() }).from(t.clients),
      db.select({ n: count() }).from(t.invoices),
      db.select({ n: count() }).from(t.batches),
      db.select({ n: count() }).from(t.findings),
      db
        .select({ id: t.clients.id })
        .from(t.clients)
        .where(eq(t.clients.id, DEMO_BORROWER_ID))
        .limit(1),
    ]);
    clientCount = clients[0]?.n ?? 0;
    invoiceCount = invoices[0]?.n ?? 0;
    batchCount = batches[0]?.n ?? 0;
    findingCount = findings[0]?.n ?? 0;
    pinnedClientFound = pinned.length > 0;
  }
  const report = assessDemoReadiness({
    foundTables,
    clientCount,
    invoiceCount,
    batchCount,
    findingCount,
    pinnedClientFound,
    migrationJournalFound: tracked.rows[0]?.exists === true,
  });
  console.log(
    JSON.stringify(
      {
        target,
        status: report.readyForSyntheticSmoke
          ? "PRELIMINARY_READY"
          : "NOT_READY",
        counts: {
          clients: clientCount,
          invoices: invoiceCount,
          batches: batchCount,
          findings: findingCount,
        },
        ...report,
      },
      null,
      2,
    ),
  );
  if (!report.readyForSyntheticSmoke) process.exitCode = 1;
}

main()
  .catch(() => {
    console.error(
      "Read-only demo preflight could not complete. Check the target and schema without printing credentials.",
    );
    process.exitCode = 1;
  })
  .finally(() => closeDb());
