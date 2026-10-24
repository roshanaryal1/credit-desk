import { eq, ne } from "drizzle-orm";
import type { ChatCompletionMessage } from "openai/resources/chat/completions";
import { beforeAll, describe, expect, it } from "vitest";

import type { LlmClient, LlmRequest, LlmResult } from "@/lib/agent/llm";
import { runAgentForIncident } from "@/lib/agent/runner";
import { createMemoryDb, type Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { DEMO_TODAY } from "@/lib/demo";
import { DEV_PARAMS, generate } from "@/lib/seed/generate";
import { writeDataset } from "@/lib/seed/write";
import { runWatchRange } from "@/lib/watch/runner";

const call = (name: string, args: unknown): ChatCompletionMessage => ({
  role: "assistant",
  content: null,
  refusal: null,
  tool_calls: [
    {
      id: `c_${name}`,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    },
  ],
});

class Scripted implements LlmClient {
  provider = "test";
  model = "scripted";
  n = 0;
  constructor(
    private readonly steps: ((r: LlmRequest) => ChatCompletionMessage)[],
  ) {}
  async complete(r: LlmRequest): Promise<LlmResult> {
    const step = this.steps[this.n++];
    if (!step) throw new Error("script exhausted");
    return { message: step(r), tokensIn: 1, tokensOut: 1 };
  }
}

let db: Db;

beforeAll(async () => {
  db = await createMemoryDb();
  await writeDataset(db, generate(DEV_PARAMS));
  await runWatchRange(db, "2026-07-22", DEMO_TODAY);
}, 60_000);

describe("incident agent", () => {
  it("explains a High incident from records returned by get_incident", async () => {
    const [incident] = await db
      .select()
      .from(t.incidents)
      .where(eq(t.incidents.severity, "HIGH"))
      .limit(1);
    const llm = new Scripted([
      () => call("get_incident", { incident_id: incident!.id }),
      () =>
        call("submit_explanation", {
          summary: `Incident first detected ${incident!.firstDetectedDate}.`,
          risk_level: "high",
          recommendation: "REQUEST_INFO",
          questions_for_client: ["When will the debtor pay?"],
          claims: [
            {
              text: `First detected ${incident!.firstDetectedDate}.`,
              evidence_ids: [incident!.id],
            },
          ],
          cited_evidence_ids: [incident!.id],
        }),
    ]);
    const out = await runAgentForIncident(db, llm, incident!.id, {
      codeSha: "test",
      log: () => {},
    });
    expect(out.errors).toEqual([]);
    expect(out.status).toBe("PASSED");
    const [run] = await db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.id, out.runId));
    expect(run).toMatchObject({
      subjectType: "INCIDENT",
      subjectId: incident!.id,
    });
  });

  it("never returns a detection date later than the scope date", async () => {
    const [incident] = await db
      .select()
      .from(t.incidents)
      .where(eq(t.incidents.severity, "HIGH"))
      .limit(1);
    const { ToolExecutor } = await import("@/lib/agent/tools");
    const scope = incident!.firstDetectedDate;
    const tools = new ToolExecutor(db, {
      clientId: incident!.clientId,
      asOf: scope,
    });
    const out = (await tools.getIncident(incident!.id)) as {
      lastDetectedDate: string | null;
    };
    expect(out.lastDetectedDate! <= scope).toBe(true);
  });

  it("does not run on incidents below High", async () => {
    const [medium] = await db
      .select()
      .from(t.incidents)
      .where(ne(t.incidents.severity, "HIGH"))
      .limit(1);
    const llm = new Scripted([]);
    const out = await runAgentForIncident(db, llm, medium!.id, {
      codeSha: "test",
      log: () => {},
    });
    expect(out.status).toBe("SKIPPED");
    expect(llm.n).toBe(0);
  });
});
