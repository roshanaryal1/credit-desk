import { eq, sql } from "drizzle-orm";
import type { ChatCompletionMessage } from "openai/resources/chat/completions";
import { describe, expect, it } from "vitest";

import type { LlmClient, LlmRequest, LlmResult } from "@/lib/agent/llm";
import {
  buildRunEvidenceManifest,
  verifyCapturedRunEvidence,
} from "@/lib/agent/manifest";
import { runAgentForInvoice } from "@/lib/agent/runner";
import { runAllBatches } from "@/lib/checks/runner";
import { createMemoryDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { DEV_PARAMS, generate } from "@/lib/seed/generate";
import { writeDataset } from "@/lib/seed/write";
import { storedExplanationUsable } from "@/lib/agent/stored-validation";
import { sha256 } from "@/lib/trust/canonical";

const toolCall = (id: string): ChatCompletionMessage => ({
  role: "assistant",
  content: null,
  refusal: null,
  tool_calls: [
    {
      id: "call_get_invoice",
      type: "function",
      function: {
        name: "get_invoice",
        arguments: JSON.stringify({ invoice_id: id }),
      },
    },
  ],
});
const result = (answer: unknown): ChatCompletionMessage => ({
  role: "assistant",
  content: JSON.stringify(answer),
  refusal: null,
});

function model(invoice: typeof t.invoices.$inferSelect): LlmClient {
  let calls = 0;
  return {
    provider: "scripted-test",
    model: "synthetic-exact-replay",
    async complete(_request: LlmRequest): Promise<LlmResult> {
      calls++;
      const answer = {
        summary: "This invoice needs additional review.",
        risk_level: "medium",
        recommendation: "HOLD",
        questions_for_client: [],
        claims: [
          {
            text: "Submitted invoice record for review.",
            evidence_ids: [invoice.id],
          },
        ],
        cited_evidence_ids: [invoice.id],
      };
      return {
        message: calls === 1 ? toolCall(invoice.id) : result(answer),
        tokensIn: 5,
        tokensOut: 10,
      };
    },
  };
}

async function fixture() {
  const db = await createMemoryDb();
  await writeDataset(db, generate(DEV_PARAMS));
  const first = (await runAllBatches(db)).find((r) => r.findings.length > 0)!;
  const [invoice] = await db
    .select()
    .from(t.invoices)
    .where(eq(t.invoices.id, first.invoiceId));
  return { db, invoice: invoice! };
}

describe("immutable tool-evidence manifests (#164)", () => {
  it("atomically writes and independently revalidates a frozen per-run transcript", async () => {
    const { db, invoice } = await fixture();
    const done = await runAgentForInvoice(db, model(invoice), invoice.id, {
      codeSha: "test",
      log: () => {},
    });
    expect(done.status).toBe("PASSED");
    const [run] = await db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.id, done.runId));
    const [explanation] = await db
      .select()
      .from(t.explanations)
      .where(eq(t.explanations.agentRunId, done.runId));
    const [saved] = await db
      .select()
      .from(t.agentEvidenceManifests)
      .where(eq(t.agentEvidenceManifests.runId, done.runId));
    expect(run.evidenceManifestRequired).toBe(true);
    expect(saved.sha256).toBe(sha256(saved.canonicalJson));
    const original = JSON.parse(saved.canonicalJson);
    expect(original.clientId).toBe(invoice.clientId);
    expect(original.records.map((r: { id: string }) => r.id)).toContain(
      invoice.id,
    );
    expect(
      original.toolResponses.map((row: { tool: string }) => row.tool),
    ).toEqual(["get_invoice"]);
    expect(
      await verifyCapturedRunEvidence(db, {
        run,
        explanation,
      }),
    ).toBe("PASSED");

    // Source changes cannot silently replace a captured original record.
    await db
      .update(t.invoices)
      .set({ amountCents: invoice.amountCents + 50_000 })
      .where(eq(t.invoices.id, invoice.id));
    expect(
      await verifyCapturedRunEvidence(db, {
        run,
        explanation,
      }),
    ).toBe("PASSED");
    expect(
      await storedExplanationUsable(db, {
        run,
        explanation,
      }),
    ).toBe(true);
  }, 90_000);

  it("rejects cross-client capture before writing any manifest", () => {
    expect(() =>
      buildRunEvidenceManifest({
        runId: "run-x",
        clientId: "client-1",
        asOf: "2026-10-20",
        toolResponses: [],
        records: [{ id: "foreign", clientId: "client-2", amount: 10 }],
      }),
    ).toThrow(/another client/);
  });

  it("fails closed for tampering and loss, without live source fallback", async () => {
    const { db, invoice } = await fixture();
    const done = await runAgentForInvoice(db, model(invoice), invoice.id, {
      codeSha: "test",
      log: () => {},
    });
    if (done.status !== "PASSED") throw new Error("Expected test run");
    const [run] = await db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.id, done.runId));
    const [explanation] = await db
      .select()
      .from(t.explanations)
      .where(eq(t.explanations.agentRunId, done.runId));
    await expect(
      db
        .update(t.agentEvidenceManifests)
        .set({ canonicalJson: "{}" })
        .where(eq(t.agentEvidenceManifests.runId, done.runId)),
    ).rejects.toThrow();

    // Simulate full-DB privileged tampering, which triggers cannot prevent.
    await db.execute(
      sql`alter table agent_evidence_manifests disable trigger agent_evidence_manifests_append_only`,
    );
    await db.execute(
      sql`update agent_evidence_manifests set canonical_json = '{}' where run_id = ${done.runId}`,
    );
    await db.execute(
      sql`alter table agent_evidence_manifests enable trigger agent_evidence_manifests_append_only`,
    );
    expect(await verifyCapturedRunEvidence(db, { run, explanation })).toBe(
      "FAILED",
    );
    expect(await storedExplanationUsable(db, { run, explanation })).toBe(false);

    await db.execute(
      sql`alter table agent_evidence_manifests disable trigger agent_evidence_manifests_append_only`,
    );
    await db.execute(
      sql`delete from agent_evidence_manifests where run_id = ${done.runId}`,
    );
    await db.execute(
      sql`alter table agent_evidence_manifests enable trigger agent_evidence_manifests_append_only`,
    );
    expect(await verifyCapturedRunEvidence(db, { run, explanation })).toBe(
      "FAILED",
    );
  }, 90_000);

  it("rolls back the run when the evidence manifest cannot be inserted", async () => {
    const { db, invoice } = await fixture();
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(t.agentRuns).values({
          id: "run_fails_atomicity",
          subjectType: "INVOICE",
          subjectId: invoice.id,
          provider: "test",
          model: "test",
          promptVersion: "test",
          configVersion: "test",
          codeSha: "test",
          attempts: 1,
          status: "ERROR",
          tokensIn: 0,
          tokensOut: 0,
          latencyMs: 0,
          asOfDate: "2026-10-20",
          evidenceManifestRequired: true,
        });
        await tx.insert(t.agentEvidenceManifests).values({
          runId: "run_fails_atomicity",
          clientId: "nonexistent-client",
          asOfDate: "2026-10-20",
          validatorVersion: "captured-evidence-v1",
          canonicalJson: "{}",
          sha256: sha256("{}"),
        });
      }),
    ).rejects.toThrow();
    expect(
      await db
        .select()
        .from(t.agentRuns)
        .where(eq(t.agentRuns.id, "run_fails_atomicity")),
    ).toHaveLength(0);
  }, 90_000);
});
