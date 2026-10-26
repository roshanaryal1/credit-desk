import { eq, ne } from "drizzle-orm";
import type { ChatCompletionMessage } from "openai/resources/chat/completions";
import { beforeAll, describe, expect, it } from "vitest";

import type { LlmClient, LlmRequest, LlmResult } from "@/lib/agent/llm";
import { runAgentForInvoice } from "@/lib/agent/runner";
import { ToolExecutor } from "@/lib/agent/tools";
import { runAllBatches } from "@/lib/checks/runner";
import { createMemoryDb, type Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { DEV_PARAMS, generate } from "@/lib/seed/generate";
import { writeDataset } from "@/lib/seed/write";

class ScriptedLlm implements LlmClient {
  readonly provider = "test";
  readonly model = "scripted";
  calls: LlmRequest[] = [];
  constructor(
    private readonly script: ((req: LlmRequest) => ChatCompletionMessage)[],
  ) {}
  async complete(req: LlmRequest): Promise<LlmResult> {
    this.calls.push(req);
    const step = this.script[this.calls.length - 1];
    if (!step) throw new Error("script exhausted");
    return { message: step(req), tokensIn: 100, tokensOut: 50 };
  }
}

const toolCall = (
  name: string,
  args: Record<string, unknown>,
): ChatCompletionMessage => ({
  role: "assistant",
  content: null,
  refusal: null,
  tool_calls: [
    {
      id: `call_${name}`,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    },
  ],
});
const answer = (o: unknown): ChatCompletionMessage => ({
  role: "assistant",
  content: JSON.stringify(o),
  refusal: null,
});

let db: Db;
let flagged: {
  id: string;
  clientId: string;
  amountCents: number;
  issueDate: string;
};

beforeAll(async () => {
  db = await createMemoryDb();
  await writeDataset(db, generate(DEV_PARAMS));
  const results = await runAllBatches(db);
  const id = results.find((r) => r.findings.length > 0)!.invoiceId;
  const [row] = await db.select().from(t.invoices).where(eq(t.invoices.id, id));
  flagged = row!;
}, 60_000);

const dollars = (c: number) =>
  `$${(c / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const grounded = () => ({
  summary: `Invoice of ${dollars(flagged.amountCents)} needs review.`,
  risk_level: "medium",
  recommendation: "HOLD",
  questions_for_client: [],
  claims: [
    {
      text: `Face value ${dollars(flagged.amountCents)}, issued ${flagged.issueDate}.`,
      evidence_ids: [flagged.id],
    },
  ],
  cited_evidence_ids: [flagged.id],
});

describe("agent runner", () => {
  it("stores a PASSED run and explanation for a grounded answer", async () => {
    const llm = new ScriptedLlm([
      () => toolCall("get_invoice", { invoice_id: flagged.id }),
      () => answer(grounded()),
    ]);
    const out = await runAgentForInvoice(db, llm, flagged.id, {
      codeSha: "test",
      log: () => {},
    });
    expect(out).toMatchObject({ status: "PASSED", attempts: 1, toolCalls: 1 });
    const [exp] = await db
      .select()
      .from(t.explanations)
      .where(eq(t.explanations.agentRunId, out.runId));
    expect(exp?.validationStatus).toBe("PASSED");
    expect(exp?.recommendation).toBe("HOLD");
  });

  it("retries once with the errors and passes when corrected", async () => {
    const bad = { ...grounded(), cited_evidence_ids: ["inv_does_not_exist"] };
    const llm = new ScriptedLlm([
      () => toolCall("get_invoice", { invoice_id: flagged.id }),
      () => answer(bad),
      (req) => {
        const last = req.messages.at(-1);
        expect(String(last?.content)).toMatch(/inv_does_not_exist/);
        return answer(grounded());
      },
    ]);
    const out = await runAgentForInvoice(db, llm, flagged.id, {
      codeSha: "test",
      log: () => {},
    });
    expect(out).toMatchObject({ status: "PASSED", attempts: 2 });
  });

  it("stores no stale errors on an explanation that passed on retry", async () => {
    const bad = { ...grounded(), cited_evidence_ids: ["inv_does_not_exist"] };
    const llm = new ScriptedLlm([
      () => toolCall("get_invoice", { invoice_id: flagged.id }),
      () => answer(bad),
      () => answer(grounded()),
    ]);
    const out = await runAgentForInvoice(db, llm, flagged.id, {
      codeSha: "test",
      log: () => {},
    });
    expect(out).toMatchObject({ status: "PASSED", errors: [] });
    const [exp] = await db
      .select()
      .from(t.explanations)
      .where(eq(t.explanations.agentRunId, out.runId));
    expect(exp?.validationErrors).toEqual([]);
  });

  it("stops at the run deadline without another model call", async () => {
    let clock = 0;
    const llm = new ScriptedLlm([
      () => {
        clock = 31_000;
        return toolCall("get_invoice", { invoice_id: flagged.id });
      },
    ]);
    const out = await runAgentForInvoice(db, llm, flagged.id, {
      codeSha: "test",
      log: () => {},
      now: () => clock,
    });
    expect(out.status).toBe("ERROR");
    expect(out.errors).toEqual(["run budget exceeded"]);
    expect(llm.calls).toHaveLength(1);
  });

  it("stores FAILED after a second invalid answer", async () => {
    const bad = { ...grounded(), summary: "Invoice is for $1.00." };
    const llm = new ScriptedLlm([
      () => toolCall("get_invoice", { invoice_id: flagged.id }),
      () => answer(bad),
      () => answer(bad),
    ]);
    const out = await runAgentForInvoice(db, llm, flagged.id, {
      codeSha: "test",
      log: () => {},
    });
    expect(out.status).toBe("FAILED");
    const [run] = await db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.id, out.runId));
    expect(run?.status).toBe("FAILED");
  });

  it("caps tool calls and then forces the submit tool", async () => {
    const script = Array.from(
      { length: 6 },
      () => () => toolCall("get_invoice", { invoice_id: flagged.id }),
    );
    const llm = new ScriptedLlm([...script, () => answer(grounded())]);
    const out = await runAgentForInvoice(db, llm, flagged.id, {
      codeSha: "test",
      log: () => {},
    });
    expect(out.toolCalls).toBe(6);
    expect(llm.calls.at(-1)?.toolChoice).toEqual({
      type: "function",
      function: { name: "submit_explanation" },
    });
    expect(out.status).toBe("PASSED");
  });

  it("accepts the answer through the submit_explanation tool", async () => {
    const llm = new ScriptedLlm([
      () => toolCall("get_invoice", { invoice_id: flagged.id }),
      () => toolCall("submit_explanation", grounded()),
    ]);
    const out = await runAgentForInvoice(db, llm, flagged.id, {
      codeSha: "test",
      log: () => {},
    });
    expect(out).toMatchObject({ status: "PASSED", toolCalls: 1 });
  });

  it("recovers once from a provider tool validation error", async () => {
    let n = 0;
    const llm: LlmClient = {
      provider: "test",
      model: "scripted",
      async complete() {
        n++;
        if (n === 1) {
          return {
            message: toolCall("get_invoice", { invoice_id: flagged.id }),
            tokensIn: 10,
            tokensOut: 10,
          };
        }
        if (n === 2)
          throw new Error(
            "400 Tool call validation failed: attempted to call tool 'JSON'",
          );
        return {
          message: toolCall("submit_explanation", grounded()),
          tokensIn: 10,
          tokensOut: 10,
        };
      },
    };
    const out = await runAgentForInvoice(db, llm, flagged.id, {
      codeSha: "test",
      log: () => {},
    });
    expect(out).toMatchObject({ status: "PASSED", attempts: 2 });
  });

  it("redacts provider exceptions from outcomes, logs and durable evidence", async () => {
    const marker = "SYNTHETIC_PRIVATE_UPSTREAM_DETAIL";
    const logs: Record<string, unknown>[] = [];
    const llm = new ScriptedLlm([
      () => {
        throw new Error(marker, { cause: { privateResponseDetail: marker } });
      },
    ]);
    const out = await runAgentForInvoice(db, llm, flagged.id, {
      codeSha: "test",
      log: (line) => logs.push(line),
    });
    expect(out.status).toBe("ERROR");
    expect(out.errors).toEqual([
      "The agent service is temporarily unavailable. Try the run again.",
    ]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      event: "agent_run",
      runId: out.runId,
      errorCode: "RUN_FAILED",
      errorCount: 1,
    });
    expect(logs[0]).not.toHaveProperty("errors");
    expect(logs[0]).not.toHaveProperty("subjectId");
    const [capture] = await db
      .select()
      .from(t.agentEvidenceManifests)
      .where(eq(t.agentEvidenceManifests.runId, out.runId));
    expect(JSON.stringify({ out, logs, capture })).not.toContain(marker);
  }, 30_000);

  it("does not echo private provider diagnostics into the recovery request", async () => {
    const marker = "SYNTHETIC_PRIVATE_TOOL_FAILURE";
    let calls = 0;
    const messages: unknown[] = [];
    const llm: LlmClient = {
      provider: "test",
      model: "scripted",
      async complete(request) {
        messages.push(structuredClone(request.messages));
        calls++;
        if (calls === 1) {
          return {
            message: toolCall("get_invoice", { invoice_id: flagged.id }),
            tokensIn: 1,
            tokensOut: 1,
          };
        }
        if (calls === 2)
          throw new Error(`Tool call validation failed: ${marker}`);
        return { message: answer(grounded()), tokensIn: 1, tokensOut: 1 };
      },
    };
    const logs: Record<string, unknown>[] = [];
    const out = await runAgentForInvoice(db, llm, flagged.id, {
      codeSha: "test",
      log: (line) => logs.push(line),
    });
    expect(out).toMatchObject({ status: "PASSED", attempts: 2, errors: [] });
    expect(calls).toBe(3);
    expect(JSON.stringify({ out, logs, messages })).not.toContain(marker);
  }, 30_000);

  it.each([null, "SYNTHETIC_NON_ERROR_DETAIL"])(
    "safely classifies non-Error provider rejection %s",
    async (failure) => {
      const llm = new ScriptedLlm([
        () => {
          throw failure;
        },
      ]);
      const logs: Record<string, unknown>[] = [];
      const out = await runAgentForInvoice(db, llm, flagged.id, {
        codeSha: "test",
        log: (line) => logs.push(line),
      });
      expect(out.status).toBe("ERROR");
      expect(out.errors).toEqual([
        "The agent service is temporarily unavailable. Try the run again.",
      ]);
      expect(JSON.stringify({ out, logs })).not.toContain(
        "SYNTHETIC_NON_ERROR_DETAIL",
      );
    },
    30_000,
  );

  it("skips clear invoices without calling the model", async () => {
    const results = await runAllBatches(db);
    const clear = results.find((r) => r.findings.length === 0)!.invoiceId;
    const llm = new ScriptedLlm([]);
    const out = await runAgentForInvoice(db, llm, clear, {
      codeSha: "test",
      log: () => {},
    });
    expect(out.status).toBe("SKIPPED");
    expect(llm.calls).toHaveLength(0);
  });
});

describe("agent tools", () => {
  it("never returns another client's records", async () => {
    const [other] = await db
      .select()
      .from(t.invoices)
      .where(ne(t.invoices.clientId, flagged.clientId));
    const tools = new ToolExecutor(db, {
      clientId: flagged.clientId,
      asOf: "2026-10-20",
    });
    const res = (await tools.getInvoice(other!.id)) as { error?: string };
    expect(res.error).toMatch(/not found/);
  });

  it("finds a debtor's receipts through allocations, whatever the counterparty name", async () => {
    const [alloc] = await db
      .select({
        bankId: t.receiptAllocations.bankTransactionId,
        debtorId: t.ledgerEntries.debtorId,
        clientId: t.ledgerEntries.clientId,
        date: t.bankTransactions.date,
      })
      .from(t.receiptAllocations)
      .innerJoin(
        t.ledgerEntries,
        eq(t.receiptAllocations.ledgerEntryId, t.ledgerEntries.id),
      )
      .innerJoin(
        t.bankTransactions,
        eq(t.receiptAllocations.bankTransactionId, t.bankTransactions.id),
      )
      .limit(1);
    await db
      .update(t.bankTransactions)
      .set({ counterpartyName: "SOME OTHER NAME" })
      .where(eq(t.bankTransactions.id, alloc!.bankId));
    const tools = new ToolExecutor(db, {
      clientId: alloc!.clientId,
      asOf: "2026-10-20",
    });
    const res = (await tools.getBankTransactions(
      alloc!.debtorId,
      "2025-01-01",
      "2026-10-20",
    )) as {
      transactions: { id: string }[];
      truncated: boolean;
    };
    expect(res.transactions.map((x) => x.id)).toContain(alloc!.bankId);
    expect(typeof res.truncated).toBe("boolean");
  });

  it("rejects malformed arguments as data, not exceptions", async () => {
    const tools = new ToolExecutor(db, {
      clientId: flagged.clientId,
      asOf: "2026-10-20",
    });
    expect(await tools.run("get_invoice", "{bad json")).toMatchObject({
      error: expect.any(String),
    });
    expect(await tools.run("get_invoice", "{}")).toMatchObject({
      error: expect.stringMatching(/invalid/),
    });
    expect(await tools.run("drop_table", "{}")).toMatchObject({
      error: expect.stringMatching(/unknown/),
    });
  });
});
