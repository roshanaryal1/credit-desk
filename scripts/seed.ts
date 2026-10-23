import { sql } from "drizzle-orm";
import { parseArgs } from "node:util";

import { runAllBatches } from "@/lib/checks/runner";
import { closeDb, getDb } from "@/lib/db/client";
import { DEV_PARAMS, HOLDOUT_PARAMS, generate } from "@/lib/seed/generate";
import { liveDecisionCount, summarise, writeDataset } from "@/lib/seed/write";

// Usage: npm run seed -- --target=local [--seed=dev|holdout] [--force]
// Wipes the schema's data and writes a deterministic dataset (SPEC 5).

const { values } = parseArgs({
  options: {
    target: { type: "string" },
    seed: { type: "string", default: "dev" },
    force: { type: "boolean", default: false },
  },
});

const TARGETS = ["local", "preview", "production"] as const;

async function main() {
  const target = values.target;
  if (!TARGETS.includes(target as (typeof TARGETS)[number])) {
    throw new Error(`--target is required: one of ${TARGETS.join(", ")}`);
  }
  if (target !== "local" && !process.env.DATABASE_URL) {
    throw new Error(`--target=${target} needs DATABASE_URL`);
  }
  if (target === "local" && process.env.DATABASE_URL) {
    throw new Error("--target=local must not run with DATABASE_URL set");
  }
  const params = values.seed === "holdout" ? HOLDOUT_PARAMS : DEV_PARAMS;

  const db = await getDb();
  const live = await liveDecisionCount(db);
  if (live > 0 && !values.force) {
    throw new Error(
      `refusing to reset: ${live} live decisions exist. Re-run with --force to discard them.`,
    );
  }

  const tables = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename not like '__drizzle%'`,
  );
  const names = tables.rows.map((r) => `"${r.tablename}"`).join(", ");
  // TRUNCATE does not fire row-level triggers, so append-only tables reset too.
  if (names) await db.execute(sql.raw(`TRUNCATE ${names} CASCADE`));

  const ds = generate(params);
  await writeDataset(db, ds);
  const results = await runAllBatches(db);
  const flagged = results.filter((r) => r.findings.length > 0).length;
  const summary = summarise(ds);
  console.log(`Seeded ${params.name} dataset into ${target}.`);
  console.table(summary.tables);
  console.log(
    `Labelled invoices: ${summary.labelledInvoices} of ${ds.invoices.length} (${(summary.labelledShare * 100).toFixed(1)}%)`,
  );
  console.table(summary.perProblem);
  console.log("Clean cases:", summary.cleanCases);
  console.table(summary.scriptedEvents);
  console.log(
    `Checks run: ${results.length} invoices, ${flagged} with findings.`,
  );
}

main()
  .then(() => closeDb())
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDb();
    process.exitCode = 1;
  });
