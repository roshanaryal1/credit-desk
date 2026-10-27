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
import {
  buildRunEvidenceManifest,
  type CapturedToolResponse,
} from "./manifest";

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

function serviceFailure(error: unknown) {
  if (error instanceof DeadlineExceeded) {
    return {
      code: "BUDGET_EXCEEDED",
      message: "run budget exceeded",
      schemaRejected: false,
    };
  }
  // Classify privately. Upstream text must never be logged, persisted as a
  // diagnostic, returned to the caller or copied into another model request.
  const schemaRejected =
    error instanceof Error &&
    /tool call validation failed|parsing failed|did not match schema/i.test(
      error.message,
    );
  return {
    code: schemaRejected ? "PROVIDER_OUTPUT_REJECTED" : "RUN_FAILED",
    message: schemaRejected
      ? "The agent service rejected its output. Try the run again."
      : "The agent service is temporarily unavailable. Try the run again.",
    schemaRejected,
  };
}

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
  // The count keeps ids readable; the random suffix keeps concurrent runs
  // for the same subject from colliding.
  return `run_${id}_${(prior?.n ?? 0) + 1}_${crypto.randomUUID().slice(0, 6)}`;
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
  const capturedToolResponses: CapturedToolResponse[] = [];
  const knownToolNames = new Set(
    TOOL_DEFINITIONS.filter((tool) => tool.type === "function").map(
      (tool) => tool.function.name,
    ),
  );

  let failureCode: string | undefined;
  let providerSchemaRejected = false;
  try {
    for (;;) {
      if (now() >= deadline) throw new DeadlineExceeded();
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
          if (now() >= deadline) throw new DeadlineExceeded();
          toolCalls++;
          const output =
            toolCalls <= AGENT_LIMITS.maxToolCalls
              ? await tools.run(call.function.name, call.function.arguments)
              : {
                  error: `tool call limit reached; call ${SUBMIT_TOOL_NAME} now`,
                };
          const known = knownToolNames.has(call.function.name);
          capturedToolResponses.push({
            sequence: capturedToolResponses.length + 1,
            tool: known ? call.function.name : "UNSUPPORTED",
            // Unknown names may contain untrusted text; omit them from the
            // durable transcript. Never save raw args, API headers or keys.
            response: known ? output : { error: "unsupported tool" },
          });
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
        // Errors from an earlier attempt do not describe the accepted output.
        errors = [];
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
    const failure = serviceFailure(err);
    errors = [failure.message];
    failureCode = failure.code;
    providerSchemaRejected = failure.schemaRejected;
  }
  // A provider-side rejection of malformed model output (an undeclared tool,
  // arguments that do not match the schema, or unparseable output) counts as
  // a failed attempt and is retried once.
  if (status === "ERROR" && attempts < 2 && providerSchemaRejected) {
    attempts++;
    messages.push({
      role: "user",
      content: `The previous tool response was rejected. Call ${SUBMIT_TOOL_NAME} now with your answer.`,
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
      const failure = serviceFailure(err);
      status = "ERROR";
      failureCode = failure.code;
      errors = [...errors, failure.message];
    }
  }

  const latencyMs = now() - started;
  const originalEvidence = buildRunEvidenceManifest({
    runId,
    clientId: subject.clientId,
    asOf: subject.asOf,
    toolResponses: capturedToolResponses,
    records: tools.evidence.recordsAtRun(),
  });
  // The run, original evidence and explanation commit together, so resuming never treats
  // a run as done when its explanation was not saved.
  await db.transaction(async (tx) => {
    await tx.insert(t.agentRuns).values({
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
      asOfDate: subject.asOf,
      evidenceManifestRequired: true,
    });
    await tx.insert(t.agentEvidenceManifests).values({
      runId,
      clientId: subject.clientId,
      asOfDate: subject.asOf,
      validatorVersion: originalEvidence.body.validatorVersion,
      canonicalJson: originalEvidence.canonicalText,
      sha256: originalEvidence.digest,
    });
    const value = result?.value;
    if (value) {
      await tx.insert(t.explanations).values({
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
  });

  log({
    event: "agent_run",
    runId,
    subjectType: subject.type,
    promptVersion: PROMPT_VERSION,
    status,
    attempts,
    toolCalls,
    tokensIn,
    tokensOut,
    latencyMs,
    errorCode:
      status === "ERROR"
        ? failureCode
        : status === "FAILED"
          ? "VALIDATION_FAILED"
          : null,
    errorCount: errors.length,
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
