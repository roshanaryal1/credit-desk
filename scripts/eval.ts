import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { CONFIG_VERSION } from "@/lib/checks/config";
import { runAllBatches } from "@/lib/checks/runner";
import { createMemoryDb } from "@/lib/db/client";
import { DEMO_TODAY } from "@/lib/demo";
import {
  agentMetrics,
  type StoredExplanation,
  type StoredRun,
} from "@/lib/eval/agent";
import { CHECK_IDS, gateFailures, scoreChecks } from "@/lib/eval/checks";
import {
  DEV_PARAMS,
  HOLDOUT_PARAMS,
  generate,
  type SeedParams,
} from "@/lib/seed/generate";
import { writeDataset } from "@/lib/seed/write";

// Deterministic evaluation (SPEC 9.4). Builds each seed in memory, runs the
// checks, scores them against labels and writes eval/report.json. Exits
// non-zero when a holdout metric is below its configured minimum.

async function evaluateSeed(params: SeedParams) {
  const ds = generate(params);
  const db = await createMemoryDb();
  await writeDataset(db, ds);
  const results = await runAllBatches(db);
  const predicted = new Map(
    results.map((r) => [
      r.invoiceId,
      new Set(r.findings.map((f) => f.checkId)),
    ]),
  );
  const expected = new Map(
    ds.labels.map((l) => [l.invoiceId, new Set(l.expectedCheckIds)]),
  );
  const misses = results.flatMap((r) => {
    const want = expected.get(r.invoiceId) ?? new Set<string>();
    const got = predicted.get(r.invoiceId) ?? new Set<string>();
    const fp = [...got].filter((c) => !want.has(c));
    const fn = [...want].filter((c) => !got.has(c));
    return fp.length || fn.length
      ? [{ invoiceId: r.invoiceId, falsePositives: fp, falseNegatives: fn }]
      : [];
  });
  return {
    seed: params.name,
    invoices: ds.invoices.length,
    labelledInvoices: ds.labels.filter((l) => l.expectedCheckIds.length > 0)
      .length,
    checks: scoreChecks(predicted, expected),
    misses,
  };
}

const fmt = (v: number | null) => (v === null ? "n/a" : v.toFixed(2));

async function main() {
  const dev = await evaluateSeed(DEV_PARAMS);
  const holdout = await evaluateSeed(HOLDOUT_PARAMS);
  const failures = gateFailures(holdout.checks);

  // Agent metrics come from the precompute export; CI never calls the model.
  const runsFile = "eval/agent-runs.json";
  const agent = existsSync(runsFile)
    ? (() => {
        const data = JSON.parse(readFileSync(runsFile, "utf8")) as {
          promptVersion: string;
          runs: StoredRun[];
          explanations: StoredExplanation[];
        };
        return {
          promptVersion: data.promptVersion,
          ...agentMetrics(data.runs, data.explanations),
        };
      })()
    : null;

  const report = {
    schemaVersion: 1,
    demoToday: DEMO_TODAY,
    configVersion: CONFIG_VERSION,
    limits: [
      "Synthetic data: labels come from the generator, not from real losses.",
      "Small sample: a few hundred invoices and a handful of positives per check.",
      "Thresholds are defaults from the specification, not calibrated on real loss data.",
      "Labels and checks both encode SPEC 6, so high scores show the code implements the specification; they do not show the rules catch real fraud.",
    ],
    checks: { dev, holdout },
    agent,
    gate: { passed: failures.length === 0, failures },
  };
  mkdirSync("eval", { recursive: true });
  writeFileSync("eval/report.json", `${JSON.stringify(report, null, 2)}\n`);

  for (const seed of [dev, holdout]) {
    console.log(
      `\n${seed.seed}: ${seed.invoices} invoices, ${seed.labelledInvoices} labelled`,
    );
    console.table(
      Object.fromEntries(
        CHECK_IDS.map((c) => {
          const m = seed.checks[c];
          return [
            c,
            {
              tp: m.tp,
              fp: m.fp,
              fn: m.fn,
              tn: m.tn,
              precision: fmt(m.precision),
              recall: fmt(m.recall),
            },
          ];
        }),
      ),
    );
    if (seed.misses.length > 0) console.table(seed.misses);
  }
  if (agent) {
    console.log("\nAgent (from stored runs):");
    console.table(agent);
  } else {
    console.log(
      "\nAgent: no eval/agent-runs.json yet; run npm run precompute.",
    );
  }
  if (failures.length > 0) {
    console.error("\nEvaluation gate failed on the holdout seed:");
    console.table(failures);
    process.exit(1);
  }
  console.log("\nEvaluation gate passed.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
