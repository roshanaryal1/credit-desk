import { and, eq, sql } from "drizzle-orm";
import type { ChatCompletionMessage } from "openai/resources/chat/completions";
import { describe, expect, it } from "vitest";

import type { LlmClient, LlmResult } from "@/lib/agent/llm";
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

function model(
  invoice: typeof t.invoices.$inferSelect,
  toolNames = ["get_invoice"],
): LlmClient {
  let calls = 0;
  return {
    provider: "scripted-test",
    model: "synthetic-exact-replay",
    async complete(): Promise<LlmResult> {
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
        message:
          calls === 1
            ? {
                ...toolCall(invoice.id),
                tool_calls: toolNames.map((name, i) => ({
                  id: `capture-${i}`,
                  type: "function" as const,
                  function: {
                    name,
                    arguments: JSON.stringify({ invoice_id: invoice.id }),
                  },
                })),
              }
            : result(answer),
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
    expect(
      await storedExplanationUsable(db, { run, explanation }, "2020-01-01"),
    ).toBe(false);
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

it("rejects subject-client/date mismatch and incomplete or substituted transcripts", async () => {
  const { db, invoice } = await fixture();
  const done = await runAgentForInvoice(db, model(invoice), invoice.id, {
    codeSha: "test",
    log: () => {},
  });
  const [run] = await db
    .select()
    .from(t.agentRuns)
    .where(eq(t.agentRuns.id, done.runId));
  const [explanation] = await db
    .select()
    .from(t.explanations)
    .where(eq(t.explanations.agentRunId, run.id));
  const [saved] = await db
    .select()
    .from(t.agentEvidenceManifests)
    .where(eq(t.agentEvidenceManifests.runId, run.id));
  const foreign = (await db.select().from(t.invoices)).find(
    (i) => i.clientId !== invoice.clientId,
  )!;
  expect(
    await storedExplanationUsable(db, {
      run: { ...run, subjectId: foreign.id },
      explanation,
    }),
  ).toBe(false);
  expect(
    await storedExplanationUsable(db, {
      run: { ...run, subjectId: "absent-subject" },
      explanation,
    }),
  ).toBe(false);
  const original = JSON.parse(saved.canonicalJson);
  const changes = [
    (p: typeof original) => {
      p.toolResponses = [];
    },
    (p: typeof original) => {
      p.toolResponses[0].tool = "get_nonexistent";
    },
    (p: typeof original) => {
      p.toolResponses[0].sequence = 2;
    },
    (p: typeof original) => {
      p.records.push({ ...p.records[0], id: "orphan" });
    },
    (p: typeof original) => {
      p.records[0].amount += 1;
    },
    (p: typeof original) => {
      p.toolResponses[0].response.clientId = foreign.clientId;
    },
    (p: typeof original) => {
      p.records[0].submittedDate = p.toolResponses[0].response.submittedDate =
        "2099-01-01";
    },
  ];
  await db.execute(
    sql`alter table agent_evidence_manifests disable trigger agent_evidence_manifests_append_only`,
  );
  for (const change of changes) {
    const payload = structuredClone(original);
    change(payload);
    const { canonicalJson } = await import("@/lib/trust/canonical");
    const canonical = canonicalJson(payload);
    await db
      .update(t.agentEvidenceManifests)
      .set({ canonicalJson: canonical, sha256: sha256(canonical) })
      .where(eq(t.agentEvidenceManifests.runId, run.id));
    expect(await storedExplanationUsable(db, { run, explanation })).toBe(false);
  }
  const { canonicalJson } = await import("@/lib/trust/canonical");
  const backdated = { ...original, asOf: "2020-01-01" };
  const canonical = canonicalJson(backdated);
  await db
    .update(t.agentEvidenceManifests)
    .set({
      canonicalJson: canonical,
      sha256: sha256(canonical),
      asOfDate: backdated.asOf,
    })
    .where(eq(t.agentEvidenceManifests.runId, run.id));
  expect(
    await storedExplanationUsable(db, {
      run: { ...run, asOfDate: backdated.asOf },
      explanation,
    }),
  ).toBe(false);
});

it("freezes the verified original capture after current invoice data changes", async () => {
  const { db, invoice } = await fixture();
  const done = await runAgentForInvoice(db, model(invoice), invoice.id, {
    codeSha: "test",
    log: () => {},
  });
  const [capture] = await db
    .select()
    .from(t.agentEvidenceManifests)
    .where(eq(t.agentEvidenceManifests.runId, done.runId));
  await db
    .update(t.invoices)
    .set({ amountCents: invoice.amountCents + 50000 })
    .where(eq(t.invoices.id, invoice.id));
  const { reviewState } = await import("@/lib/trust/review");
  const { saveDecision } = await import("@/lib/trust/decide");
  const state = await reviewState(db, invoice.id);
  expect(state.explanation).not.toBeNull();
  const saved = await saveDecision(
    db,
    {
      invoiceId: invoice.id,
      decision: "HOLD",
      reason: "Synthetic test decision",
      reviewVersion: state.version,
      idempotencyKey: "manifest-snapshot-test",
    },
    { sessionId: "test", displayName: "Test", mode: "SHADOW" },
    { codeSha: "test" },
  );
  if (!saved.ok) throw Error(saved.message);
  const [snapshot] = await db
    .select()
    .from(t.decisionSnapshots)
    .where(eq(t.decisionSnapshots.decisionId, saved.decisionId));
  const frozen = JSON.parse(snapshot.canonicalJson);
  expect(frozen.schemaVersion).toBe(3);
  expect(frozen.explanation.run.id).toBe(done.runId);
  expect(frozen.agentEvidenceSource).toBe("CAPTURED");
  expect(frozen.agentEvidenceManifest.canonicalJson).toBe(
    capture.canonicalJson,
  );
  expect(frozen.agentEvidenceManifest.sha256).toBe(capture.sha256);
  expect(frozen.citedRecords[invoice.id].amount).toBe(
    invoice.amountCents / 100,
  );
  expect(frozen.checkContext.invoice.amountCents).toBe(
    invoice.amountCents + 50000,
  );
  const { resolveCapturedEvidence } = await import("@/lib/queries/evidence");
  const evidence = resolveCapturedEvidence(
    JSON.parse(capture.canonicalJson).records,
  );
  expect(evidence.get(invoice.id)?.facts).toContain(
    `amount: ${invoice.amountCents / 100}`,
  );
});

it("upgrades existing runs as legacy without rewriting their stored history", async () => {
  const { mkdtemp, cp, readFile, writeFile, rm } =
    await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const folder = await mkdtemp(join(tmpdir(), "credit-manifest-upgrade-"));
  const client = new PGlite();
  try {
    await cp("lib/db/migrations", folder, { recursive: true });
    const journalPath = join(folder, "meta/_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    journal.entries = journal.entries.filter(
      (entry: { idx: number }) => entry.idx < 6,
    );
    await writeFile(journalPath, JSON.stringify(journal));
    const db = drizzle({ client, schema: t });
    await migrate(db, { migrationsFolder: folder });
    await db.execute(
      sql`insert into agent_runs (id, subject_type, subject_id, provider, model, prompt_version, config_version, code_sha, attempts, status, tokens_in, tokens_out, latency_ms, as_of_date) values ('legacy-upgrade', 'INVOICE', 'legacy-subject', 'test', 'test', 'test', 'test', 'test', 1, 'PASSED', 0, 0, 0, '2026-10-20')`,
    );
    const before = await client.query<{ body: string }>(
      "select row_to_json(agent_runs)::text as body from agent_runs where id='legacy-upgrade'",
    );
    await migrate(db, { migrationsFolder: "lib/db/migrations" });
    const [run] = await db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.id, "legacy-upgrade"));
    expect(run.evidenceManifestRequired).toBe(false);
    const after = await client.query<{ body: unknown }>(
      "select (to_jsonb(agent_runs) - 'evidence_manifest_required') as body from agent_runs where id='legacy-upgrade'",
    );
    expect(after.rows[0].body).toEqual(
      JSON.parse((before.rows[0] as { body: string }).body),
    );
    expect(await db.select().from(t.agentEvidenceManifests)).toEqual([]);
    // An absent original manifest is explicitly legacy, never newly captured.
    expect(
      await verifyCapturedRunEvidence(db, {
        run,
        explanation: {
          validationStatus: "PASSED",
        } as typeof t.explanations.$inferSelect,
      }),
    ).toBe("LEGACY");
  } finally {
    await client.close();
    await rm(folder, { recursive: true, force: true });
  }
});

it("captures nested ledger credits and funding adjustments through the actual runner", async () => {
  const { db, invoice } = await fixture();
  const [batch] = await db
    .select()
    .from(t.batches)
    .where(eq(t.batches.id, invoice.batchId));
  let [ledger] = await db
    .select()
    .from(t.ledgerEntries)
    .where(
      and(
        eq(t.ledgerEntries.clientId, invoice.clientId),
        eq(t.ledgerEntries.invoiceNumber, invoice.invoiceNumber),
      ),
    );
  if (!ledger)
    [ledger] = await db
      .insert(t.ledgerEntries)
      .values({
        id: "nested-ledger",
        clientId: invoice.clientId,
        debtorId: invoice.debtorId,
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate,
        recordedDate: batch.submittedDate,
        amountCents: invoice.amountCents,
      })
      .returning();
  await db
    .update(t.ledgerEntries)
    .set({ recordedDate: batch.submittedDate })
    .where(eq(t.ledgerEntries.id, ledger.id));
  await db.insert(t.creditNotes).values({
    id: "nested-credit",
    ledgerEntryId: ledger.id,
    date: batch.submittedDate,
    amountCents: 100,
  });
  const [funding] = await db
    .insert(t.fundings)
    .values({
      id: "nested-funding",
      invoiceId: invoice.id,
      fundedDate: batch.submittedDate,
      advanceCents: 10000,
    })
    .onConflictDoUpdate({
      target: t.fundings.invoiceId,
      set: { fundedDate: batch.submittedDate, advanceCents: 10000 },
    })
    .returning();
  await db.insert(t.fundingAdjustments).values({
    id: "nested-adjustment",
    fundingId: funding.id,
    kind: "COLLECTION",
    date: batch.submittedDate,
    amountCents: 100,
  });
  const done = await runAgentForInvoice(
    db,
    model(invoice, ["get_invoice", "get_ledger_entry", "get_funding"]),
    invoice.id,
    { codeSha: "test", log: () => {} },
  );
  expect(done.status).toBe("PASSED");
  const [run] = await db
    .select()
    .from(t.agentRuns)
    .where(eq(t.agentRuns.id, done.runId));
  const [explanation] = await db
    .select()
    .from(t.explanations)
    .where(eq(t.explanations.agentRunId, run.id));
  expect(await storedExplanationUsable(db, { run, explanation })).toBe(true);
  const [saved] = await db
    .select()
    .from(t.agentEvidenceManifests)
    .where(eq(t.agentEvidenceManifests.runId, run.id));
  expect(
    JSON.parse(saved.canonicalJson).records.map(
      (r: { type: string }) => r.type,
    ),
  ).toEqual(
    expect.arrayContaining([
      "invoice",
      "ledger_entry",
      "credit_note",
      "funding",
      "funding_adjustment",
    ]),
  );
});
