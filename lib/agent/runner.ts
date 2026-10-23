import { and, asc, count, eq } from "drizzle-orm";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { CONFIG_VERSION } from "@/lib/checks/config";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

import { AGENT_LIMITS } from "./config";
import { DeadlineExceeded, type LlmClient } from "./llm";
import {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  incidentUserPrompt,
  invoiceUserPrompt,
  retryPrompt,
} from "./prompts";
import {
  SUBMIT_TOOL,
  SUBMIT_TOOL_NAME,
  TOOL_DEFINITIONS,
  ToolExecutor,
} from "./tools";
import { validateOutput, type ValidationResult } from "./validator";

// Agent runner for flagged invoices (SPEC 8): a bounded tool loop, the
// citation validator, one retry with the errors, and an immutable run record.

export interface RunOutcome {
  runId: string;
  status: "PASSED" | "FAILED" | "ERROR" | "SKIPPED";
  attempts: number;
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  errors: string[];
}

export interface RunOptions {
  codeSha: string;
  now?: () => number;
  log?: (line: Record<string, unknown>) => void;
}

const defaultLog = (line: Record<string, unknown>) =>
  console.log(JSON.stringify(line));

interface Subject {
  type: "INVOICE" | "INCIDENT";
  id: string;
  clientId: string;
  asOf: string;
  userPrompt: string;
}

async function nextRunId(db: Db, type: Subject["type"], id: string) {
  const [prior] = await db
    .select({ n: count() })
    .from(t.agentRuns)
    .where(
      and(eq(t.agentRuns.subjectType, type), eq(t.agentRuns.subjectId, id)),
    );
  return `run_${id}_${(prior?.n ?? 0) + 1}`;
}

const skipped = (runId: string): RunOutcome => ({
  runId,
  status: "SKIPPED",
  attempts: 0,
  toolCalls: 0,
  tokensIn: 0,
  tokensOut: 0,
  latencyMs: 0,
  errors: [],
});

export async function runAgentForInvoice(
  db: Db,
  llm: LlmClient,
  invoiceId: string,
  opts: RunOptions,
): Promise<RunOutcome> {
  const [subject] = await db
    .select({ invoice: t.invoices, submittedDate: t.batches.submittedDate })
    .from(t.invoices)
    .innerJoin(t.batches, eq(t.invoices.batchId, t.batches.id))
    .where(eq(t.invoices.id, invoiceId));
  if (!subject) throw new Error(`invoice ${invoiceId} not found`);
  const findingRows = await db
    .select()
    .from(t.findings)
    .where(
      and(
        eq(t.findings.invoiceId, invoiceId),
        eq(t.findings.configVersion, CONFIG_VERSION),
      ),
    )
    .orderBy(asc(t.findings.checkId));
  // Clear invoices never go to the agent.
  if (findingRows.length === 0)
    return skipped(await nextRunId(db, "INVOICE", invoiceId));
  return runAgentLoop(
    db,
    llm,
    {
      type: "INVOICE",
      id: invoiceId,
      clientId: subject.invoice.clientId,
      asOf: subject.submittedDate,
      userPrompt: invoiceUserPrompt({
        invoiceId,
        debtorId: subject.invoice.debtorId,
        submittedDate: subject.submittedDate,
        findings: findingRows.map((f) => ({
          id: f.id,
          checkId: f.checkId,
          severity: f.severity,
        })),
      }),
    },
    opts,
  );
}

/** Explains a High-severity Portfolio Watch incident (SPEC 8). */
export async function runAgentForIncident(
  db: Db,
  llm: LlmClient,
  incidentId: string,
  opts: RunOptions,
): Promise<RunOutcome> {
  const [incident] = await db
    .select()
    .from(t.incidents)
    .where(eq(t.incidents.id, incidentId));
  if (!incident) throw new Error(`incident ${incidentId} not found`);
  if (incident.severity !== "HIGH")
    return skipped(await nextRunId(db, "INCIDENT", incidentId));
  return runAgentLoop(
    db,
    llm,
    {
      type: "INCIDENT",
      id: incidentId,
      clientId: incident.clientId,
      asOf: incident.lastDetectedDate,
      userPrompt: incidentUserPrompt({
        incidentId,
        ruleId: incident.ruleId,
        firstDetectedDate: incident.firstDetectedDate,
        asOf: incident.lastDetectedDate,
      }),
    },
    opts,
  );
}

async function runAgentLoop(
  db: Db,
  llm: LlmClient,
  subject: Subject,
  opts: RunOptions,
): Promise<RunOutcome> {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? defaultLog;
  const started = now();
  const runId = await nextRunId(db, subject.type, subject.id);
  const tools = new ToolExecutor(db, {
    clientId: subject.clientId,
    asOf: subject.asOf,
  });
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: subject.userPrompt },
  ];

  const deadline = started + AGENT_LIMITS.runBudgetMs;
  let attempts = 1;
  let toolCalls = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let result: ValidationResult | null = null;
  let status: "PASSED" | "FAILED" | "ERROR" = "ERROR";
  let errors: string[] = [];

  try {
    for (;;) {
      const allowTools = toolCalls < AGENT_LIMITS.maxToolCalls;
      const res = await llm.complete({
        messages,
        // Every tool stays declared (gpt-oss rejects calls to undeclared
        // tools); after the cap the submit tool is forced.
        tools: [...TOOL_DEFINITIONS, SUBMIT_TOOL],
        toolChoice: allowTools
          ? "auto"
          : { type: "function", function: { name: SUBMIT_TOOL_NAME } },
        deadline,
      });
      tokensIn += res.tokensIn;
      tokensOut += res.tokensOut;
      const calls = (res.message.tool_calls ?? []).filter(
        (c) => c.type === "function",
      );
      const submit = calls.find((c) => c.function.name === SUBMIT_TOOL_NAME);
      const investigate = calls.filter(
        (c) => c.function.name !== SUBMIT_TOOL_NAME,
      );
      if (!submit && investigate.length > 0) {
        messages.push({
          role: "assistant",
          content: res.message.content ?? "",
          tool_calls: investigate,
        });
        for (const call of investigate) {
          toolCalls++;
          const output =
            toolCalls <= AGENT_LIMITS.maxToolCalls
              ? await tools.run(call.function.name, call.function.arguments)
              : {
                  error: `tool call limit reached; call ${SUBMIT_TOOL_NAME} now`,
                };
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(output),
          });
        }
        continue;
      }
      // The answer arrives as submit_explanation arguments, or as plain JSON text.
      const content = submit
        ? submit.function.arguments
        : (res.message.content ?? "");
      result = validateOutput(content, tools.evidence);
      if (result.ok) {
        status = "PASSED";
        break;
      }
      errors = result.errors;
      if (attempts >= 2) {
        status = "FAILED";
        break;
      }
      attempts++;
      if (submit) {
        messages.push({ role: "assistant", content: "", tool_calls: [submit] });
        messages.push({
          role: "tool",
          tool_call_id: submit.id,
          content: retryPrompt(result.errors),
        });
      } else {
        messages.push({ role: "assistant", content });
        messages.push({ role: "user", content: retryPrompt(result.errors) });
      }
    }
  } catch (err) {
    status = "ERROR";
    errors = [
      err instanceof DeadlineExceeded
        ? "run budget exceeded"
        : (err as Error).message,
    ];
  }
  // A provider-side tool validation failure (the model called a tool the
  // request did not allow) counts as a failed attempt, retried once.
  if (
    status === "ERROR" &&
    attempts < 2 &&
    /tool call validation failed/i.test(errors[0] ?? "")
  ) {
    attempts++;
    messages.push({
      role: "user",
      content: `That tool call was rejected: ${errors[0]}. Call ${SUBMIT_TOOL_NAME} now with your answer.`,
    });
    try {
      const res = await llm.complete({
        messages,
        tools: [...TOOL_DEFINITIONS, SUBMIT_TOOL],
        toolChoice: { type: "function", function: { name: SUBMIT_TOOL_NAME } },
        deadline,
      });
      tokensIn += res.tokensIn;
      tokensOut += res.tokensOut;
      const submit = (res.message.tool_calls ?? []).find(
        (c) => c.type === "function" && c.function.name === SUBMIT_TOOL_NAME,
      );
      const content =
        submit && submit.type === "function"
          ? submit.function.arguments
          : (res.message.content ?? "");
      result = validateOutput(content, tools.evidence);
      status = result.ok ? "PASSED" : "FAILED";
      errors = result.ok ? [] : result.errors;
    } catch (err) {
      errors = [...errors, (err as Error).message];
    }
  }

  const latencyMs = now() - started;
  await db.insert(t.agentRuns).values({
    id: runId,
    subjectType: subject.type,
    subjectId: subject.id,
    provider: llm.provider,
    model: llm.model,
    promptVersion: PROMPT_VERSION,
    configVersion: CONFIG_VERSION,
    codeSha: opts.codeSha,
    attempts,
    status,
    tokensIn,
    tokensOut,
    latencyMs,
  });
  const value = result?.value;
  if (value) {
    await db.insert(t.explanations).values({
      id: `exp_${runId}`,
      agentRunId: runId,
      summary: value.summary,
      riskLevel: value.risk_level.toUpperCase() as "LOW" | "MEDIUM" | "HIGH",
      recommendation: value.recommendation,
      questionsForClient: value.questions_for_client,
      claims: value.claims.map((c) => ({
        text: c.text,
        evidenceIds: c.evidence_ids,
      })),
      citedEvidenceIds: value.cited_evidence_ids,
      validationStatus: status === "PASSED" ? "PASSED" : "FAILED",
      validationErrors: errors,
    });
  }

  log({
    event: "agent_run",
    runId,
    subjectType: subject.type,
    subjectId: subject.id,
    provider: llm.provider,
    model: llm.model,
    promptVersion: PROMPT_VERSION,
    status,
    attempts,
    toolCalls,
    tokensIn,
    tokensOut,
    latencyMs,
    errors,
  });
  return {
    runId,
    status,
    attempts,
    toolCalls,
    tokensIn,
    tokensOut,
    latencyMs,
    errors,
  };
}
