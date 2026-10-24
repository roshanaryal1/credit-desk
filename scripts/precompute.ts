import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { and, asc, eq, inArray } from "drizzle-orm";

import { AGENT_LIMITS, providerFromEnv } from "@/lib/agent/config";
import { OpenAiCompatibleClient } from "@/lib/agent/llm";
import { PROMPT_VERSION } from "@/lib/agent/prompts";
import { runAgentForIncident, runAgentForInvoice } from "@/lib/agent/runner";
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

  const passed = async (type: "INVOICE" | "INCIDENT") =>
    new Set(
      (
        await db
          .select({ id: t.agentRuns.subjectId })
          .from(t.agentRuns)
          .where(
            and(
              eq(t.agentRuns.subjectType, type),
              eq(t.agentRuns.status, "PASSED"),
              eq(t.agentRuns.promptVersion, PROMPT_VERSION),
              eq(t.agentRuns.configVersion, CONFIG_VERSION),
            ),
          )
      ).map((r) => r.id),
    );
  const flagged = (
    await db
      .selectDistinct({ id: t.findings.invoiceId })
      .from(t.findings)
      .where(eq(t.findings.configVersion, CONFIG_VERSION))
      .orderBy(asc(t.findings.invoiceId))
  ).map((r) => r.id);
  const highIncidents = await db
    .select({ id: t.incidents.id, asOf: t.incidents.lastDetectedDate })
    .from(t.incidents)
    .where(eq(t.incidents.severity, "HIGH"))
    .orderBy(asc(t.incidents.id));
  const high = highIncidents.map((r) => r.id);
  const doneInvoices = await passed("INVOICE");
  const doneIncidents = new Map(
    (
      await db
        .select({ id: t.agentRuns.subjectId, asOf: t.agentRuns.asOfDate })
        .from(t.agentRuns)
        .where(
          and(
            eq(t.agentRuns.subjectType, "INCIDENT"),
            eq(t.agentRuns.status, "PASSED"),
            eq(t.agentRuns.promptVersion, PROMPT_VERSION),
            eq(t.agentRuns.configVersion, CONFIG_VERSION),
          ),
        )
    ).map((r) => [r.id, r.asOf] as const),
  );
  const todo = [
    ...flagged
      .filter((id) => !doneInvoices.has(id))
      .map((id) => ({ type: "INVOICE" as const, id })),
    // An incident needs a new run when the book has moved past the date its
    // last passing explanation was written for.
    ...highIncidents
      .filter((inc) => doneIncidents.get(inc.id) !== inc.asOf)
      .map((inc) => ({ type: "INCIDENT" as const, id: inc.id })),
  ];
  const limit = values.limit ? Number(values.limit) : todo.length;
  console.log(
    `${flagged.length} flagged invoices and ${high.length} high incidents; ${doneInvoices.size + doneIncidents.size} done; running ${Math.min(limit, todo.length)}.`,
  );

  const tally = { PASSED: 0, FAILED: 0, ERROR: 0, SKIPPED: 0 };
  for (const [i, item] of todo.slice(0, limit).entries()) {
    // Wait for headroom outside the run, so the wait is not charged to its budget.
    const wait = llm.budget.waitFor(AGENT_LIMITS.tokensPerRun);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const run =
      item.type === "INVOICE" ? runAgentForInvoice : runAgentForIncident;
    const out = await run(db, llm, item.id, { codeSha: sha });
    tally[out.status]++;
    console.log(
      `[${i + 1}/${Math.min(limit, todo.length)}] ${item.id} ${out.status}`,
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
