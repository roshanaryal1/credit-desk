import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { and, asc, eq, inArray } from "drizzle-orm";

import { AGENT_LIMITS, providerFromEnv } from "@/lib/agent/config";
import { OpenAiCompatibleClient } from "@/lib/agent/llm";
import { PROMPT_VERSION } from "@/lib/agent/prompts";
import { runAgentForInvoice } from "@/lib/agent/runner";
import { CONFIG_VERSION } from "@/lib/checks/config";
import { closeDb, getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

// Usage: npm run precompute [-- --limit=5]
// Explains every flagged invoice, one at a time, within the token budget.
// Resumable: skips invoices that already have a PASSED run for the current
// prompt and config version. Writes eval/agent-runs.json for the evaluation.

const { values } = parseArgs({ options: { limit: { type: "string" } } });

function codeSha(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA)
    return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

async function main() {
  const db = await getDb();
  const llm = new OpenAiCompatibleClient(providerFromEnv());
  const sha = codeSha();

  const flagged = await db
    .selectDistinct({ invoiceId: t.findings.invoiceId })
    .from(t.findings)
    .where(eq(t.findings.configVersion, CONFIG_VERSION))
    .orderBy(asc(t.findings.invoiceId));
  const done = new Set(
    (
      await db
        .select({ id: t.agentRuns.subjectId })
        .from(t.agentRuns)
        .where(
          and(
            eq(t.agentRuns.subjectType, "INVOICE"),
            eq(t.agentRuns.status, "PASSED"),
            eq(t.agentRuns.promptVersion, PROMPT_VERSION),
            eq(t.agentRuns.configVersion, CONFIG_VERSION),
          ),
        )
    ).map((r) => r.id),
  );
  const todo = flagged.map((f) => f.invoiceId).filter((id) => !done.has(id));
  const limit = values.limit ? Number(values.limit) : todo.length;
  console.log(
    `${flagged.length} flagged invoices, ${done.size} done, running ${Math.min(limit, todo.length)}.`,
  );

  const tally = { PASSED: 0, FAILED: 0, ERROR: 0, SKIPPED: 0 };
  for (const [i, invoiceId] of todo.slice(0, limit).entries()) {
    // Wait for headroom outside the run, so the wait is not charged to its budget.
    const wait = llm.budget.waitFor(AGENT_LIMITS.tokensPerRun);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const out = await runAgentForInvoice(db, llm, invoiceId, { codeSha: sha });
    tally[out.status]++;
    console.log(
      `[${i + 1}/${Math.min(limit, todo.length)}] ${invoiceId} ${out.status}`,
    );
  }
  console.log("Run totals:", tally);

  // Export every run for the deterministic evaluation in CI.
  const runs = await db.select().from(t.agentRuns).orderBy(asc(t.agentRuns.id));
  const explanations = runs.length
    ? await db
        .select()
        .from(t.explanations)
        .where(
          inArray(
            t.explanations.agentRunId,
            runs.map((r) => r.id),
          ),
        )
    : [];
  mkdirSync("eval", { recursive: true });
  writeFileSync(
    "eval/agent-runs.json",
    `${JSON.stringify({ promptVersion: PROMPT_VERSION, configVersion: CONFIG_VERSION, runs, explanations }, null, 2)}\n`,
  );
  console.log(`Exported ${runs.length} runs to eval/agent-runs.json`);
}

main()
  .then(() => closeDb())
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDb();
    process.exitCode = 1;
  });
