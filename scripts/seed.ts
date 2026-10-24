import { parseArgs } from "node:util";

import { runAllBatches } from "@/lib/checks/runner";
import { addDays } from "@/lib/dates";
import { DEMO_TODAY, HISTORY_DAYS } from "@/lib/demo";
import { runWatchRange } from "@/lib/watch/runner";
import { closeDb, getDb } from "@/lib/db/client";
import { DEV_PARAMS, HOLDOUT_PARAMS, generate } from "@/lib/seed/generate";
import { replaceDataset, summarise } from "@/lib/seed/write";
import { seedSyntheticCaseWorkboard } from "@/lib/seed/synthetic-cases";

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
  if (values.seed !== "dev" && values.seed !== "holdout") {
    throw new Error("--seed must be one of dev, holdout");
  }
  const params = values.seed === "holdout" ? HOLDOUT_PARAMS : DEV_PARAMS;

  const ds = generate(params);
  const db = await getDb();
  await replaceDataset(db, ds, values.force);
  const results = await runAllBatches(db);
  const flagged = results.filter((r) => r.findings.length > 0).length;
  const detections = await runWatchRange(
    db,
    addDays(DEMO_TODAY, -HISTORY_DAYS),
    DEMO_TODAY,
  );
  const syntheticCases = await seedSyntheticCaseWorkboard(db, ds);
  const summary = summarise(ds);
  console.log(`Seeded ${params.name} dataset into ${target}.`);
  console.log(`Created ${syntheticCases} explicitly fictional case examples.`);
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
  console.log(`Watch run over ${HISTORY_DAYS} days: ${detections} detections.`);
}

main()
  .then(() => closeDb())
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDb();
    process.exitCode = 1;
  });
