import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  storedExplanationUsable,
  type StoredExplanation,
} from "@/lib/agent/stored-validation";
import { CONFIG_VERSION } from "@/lib/checks/config";
import { createMemoryDb, type Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { latestExplanation, reviewState } from "@/lib/trust/review";
import { saveDecision } from "@/lib/trust/decide";
import { incidentDetail } from "@/lib/queries/watch";

let db: Db;
vi.mock("@/lib/db/client", async (original) => ({
  ...(await original<typeof import("@/lib/db/client")>()),
  getDb: () => Promise.resolve(db),
}));

beforeAll(async () => {
  db = await createMemoryDb();
  await db.insert(t.clients).values([
    {
      id: "stored-client",
      name: "Synthetic evidence borrower",
      industry: "services",
      facilityLimitCents: 100_000,
      paymentTermsDays: 30,
    },
    {
      id: "other-client",
      name: "Another synthetic borrower",
      industry: "services",
      facilityLimitCents: 100_000,
      paymentTermsDays: 30,
    },
  ]);
  await db.insert(t.debtors).values([
    {
      id: "stored-debtor",
      clientId: "stored-client",
      name: "Synthetic debtor",
      nzbn: "9429000000022",
      firstSeenDate: "2026-01-01",
      creditBand: "A",
    },
    {
      id: "other-debtor",
      clientId: "other-client",
      name: "Another debtor",
      nzbn: "9429000000039",
      firstSeenDate: "2026-01-01",
      creditBand: "A",
    },
  ]);
  await db.insert(t.batches).values([
    {
      id: "stored-batch",
      clientId: "stored-client",
      submittedDate: "2026-10-20",
      status: "PENDING",
    },
    {
      id: "future-batch",
      clientId: "stored-client",
      submittedDate: "2026-10-25",
      status: "PENDING",
    },
    {
      id: "other-batch",
      clientId: "other-client",
      submittedDate: "2026-10-20",
      status: "PENDING",
    },
  ]);
  await db.insert(t.invoices).values([
    {
      id: "inv_stored",
      batchId: "stored-batch",
      clientId: "stored-client",
      debtorId: "stored-debtor",
      invoiceNumber: "STORED",
      issueDate: "2026-10-01",
      dueDate: "2026-10-31",
      amountCents: 604750,
      description: "Synthetic service",
    },
    {
      id: "inv_future",
      batchId: "future-batch",
      clientId: "stored-client",
      debtorId: "stored-debtor",
      invoiceNumber: "FUTURE",
      issueDate: "2026-10-21",
      dueDate: "2026-11-20",
      amountCents: 100,
      description: "Future service",
    },
    {
      id: "inv_other",
      batchId: "other-batch",
      clientId: "other-client",
      debtorId: "other-debtor",
      invoiceNumber: "OTHER",
      issueDate: "2026-10-01",
      dueDate: "2026-10-31",
      amountCents: 100,
      description: "Other service",
    },
  ]);
  await db.insert(t.incidents).values({
    id: "incident_stored",
    incidentKey: "STORED_TEST",
    ruleId: "OVERDUE_FUNDED",
    clientId: "stored-client",
    severity: "HIGH",
    firstDetectedDate: "2026-10-20",
    lastDetectedDate: "2026-10-20",
  });
});

let sequence = 0;
async function stored(
  input: {
    question?: string;
    summary?: string;
    claim?: string;
    citedId?: string;
    status?: "PASSED" | "FAILED";
    runStatus?: "PASSED" | "ERROR";
    incident?: boolean;
    legacy?: boolean;
  } = {},
): Promise<StoredExplanation> {
  const n = ++sequence;
  const [run] = await db
    .insert(t.agentRuns)
    .values({
      id: `stored-run-${n}`,
      subjectType: input.incident ? "INCIDENT" : "INVOICE",
      subjectId: input.incident ? "incident_stored" : "inv_stored",
      provider: "test",
      model: "recorded",
      promptVersion: "legacy",
      configVersion: CONFIG_VERSION,
      codeSha: "test",
      attempts: 1,
      status: input.runStatus ?? "PASSED",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
      asOfDate: input.legacy ? null : "2026-10-20",
      createdAt: new Date(Date.UTC(2026, 9, 25, 0, 0, n)),
    })
    .returning();
  const id =
    input.citedId ?? (input.incident ? "incident_stored" : "inv_stored");
  const [explanation] = await db
    .insert(t.explanations)
    .values({
      id: `stored-exp-${n}`,
      agentRunId: run.id,
      summary: input.summary ?? "Review the cited evidence.",
      riskLevel: "HIGH",
      recommendation: "HOLD",
      questionsForClient: input.question
        ? [input.question]
        : ["Please provide the supporting records."],
      claims: [
        { text: input.claim ?? "This record needs review.", evidenceIds: [id] },
      ],
      citedEvidenceIds: [id],
      validationStatus: input.status ?? "PASSED",
      validationErrors: [],
    })
    .returning();
  return { run, explanation };
}

describe("read-time stored explanation safety", () => {
  it("accepts a valid legacy invoice output using its submission cutoff", async () => {
    const row = await stored({ legacy: true });
    expect(await storedExplanationUsable(db, row)).toBe(true);
    expect((await latestExplanation(db, "inv_stored"))?.explanation.id).toBe(
      row.explanation.id,
    );
  });

  it("withholds a newly invalid question and never binds it to a new decision", async () => {
    const before = await reviewState(db, "inv_stored");
    const row = await stored({
      question: "Please explain the $1,170.48 difference.",
    });
    expect(await storedExplanationUsable(db, row)).toBe(false);
    expect(await latestExplanation(db, "inv_stored")).toBeNull();
    const state = await reviewState(db, "inv_stored");
    expect(state.version).not.toBe(before.version);
    expect(state.explanation).toBeNull();
    const saved = await saveDecision(
      db,
      {
        invoiceId: "inv_stored",
        decision: "HOLD",
        reason: "Need independently verified source evidence",
        reviewVersion: state.version,
        idempotencyKey: randomUUID(),
      },
      {
        sessionId: "stored-reviewer",
        displayName: "Synthetic reviewer",
        mode: "SHADOW",
      },
      { codeSha: "test" },
    );
    if (!saved.ok) throw new Error(saved.message);
    const [decision] = await db
      .select()
      .from(t.decisions)
      .where(eq(t.decisions.id, saved.decisionId));
    expect(decision.explanationIdAtDecision).toBeNull();
    const [snapshot] = await db
      .select()
      .from(t.decisionSnapshots)
      .where(eq(t.decisionSnapshots.decisionId, saved.decisionId));
    expect(JSON.parse(snapshot.canonicalJson).explanation).toBeNull();
    expect(
      (
        await db
          .select()
          .from(t.explanations)
          .where(eq(t.explanations.id, row.explanation.id))
      )[0],
    ).toEqual(row.explanation);
  });

  it("never promotes a historically failed output or failed run", async () => {
    expect(
      await storedExplanationUsable(db, await stored({ status: "FAILED" })),
    ).toBe(false);
    expect(
      await storedExplanationUsable(db, await stored({ runStatus: "ERROR" })),
    ).toBe(false);
  });

  it.each(["missing-reference", "inv_other", "inv_future"])(
    "fails closed for unavailable evidence %s",
    async (citedId) => {
      expect(await storedExplanationUsable(db, await stored({ citedId }))).toBe(
        false,
      );
    },
  );

  it("applies the same guard to incident output and its visible business date", async () => {
    const valid = await stored({ incident: true });
    expect(await storedExplanationUsable(db, valid, "2026-10-20")).toBe(true);
    expect(
      (await incidentDetail("incident_stored", "2026-10-20"))?.explained
        ?.explanation.id,
    ).toBe(valid.explanation.id);
    expect(
      (await incidentDetail("incident_stored", "2026-10-19"))?.explained,
    ).toBeNull();
    await stored({ incident: true, question: "Why was $999,999.99 approved?" });
    expect(
      (await incidentDetail("incident_stored", "2026-10-20"))?.explained,
    ).toBeNull();
  });
});

it("shows original captured agent evidence separately from current invoice inputs", async () => {
  const row = await stored();
  const { ToolExecutor } = await import("@/lib/agent/tools");
  const { buildRunEvidenceManifest } = await import("@/lib/agent/manifest");
  const tools = new ToolExecutor(db, {
    clientId: "stored-client",
    asOf: "2026-10-20",
  });
  const response = await tools.getInvoice("inv_stored");
  const capture = buildRunEvidenceManifest({
    runId: row.run.id,
    clientId: "stored-client",
    asOf: "2026-10-20",
    toolResponses: [{ sequence: 1, tool: "get_invoice", response }],
    records: tools.evidence.recordsAtRun(),
  });
  await db.insert(t.agentEvidenceManifests).values({
    runId: row.run.id,
    clientId: "stored-client",
    asOfDate: "2026-10-20",
    validatorVersion: capture.body.validatorVersion,
    canonicalJson: capture.canonicalText,
    sha256: capture.digest,
  });
  await db
    .update(t.invoices)
    .set({ amountCents: 704750 })
    .where(eq(t.invoices.id, "inv_stored"));
  const { getInvoiceReview } = await import("@/lib/queries/invoice");
  const panel = await getInvoiceReview(
    "inv_stored",
    {
      sessionId: "captured-ui",
      displayName: "Synthetic viewer",
      mode: "ASSIST",
    },
    "stored-batch",
    true,
  );
  expect(panel?.invoice.amountCents).toBe(704750);
  expect(panel?.agentEvidenceSource).toBe("CAPTURED");
  expect(panel?.agentEvidence.get("inv_stored")?.facts).toContain(
    "amount: 6047.5",
  );
  expect(panel?.agentEvidence.get("inv_stored")?.facts).not.toContain(
    "amount: 7047.5",
  );
});

afterAll(async () => {
  await db?.$client.close();
}, 30_000);

describe("complete monetary tokens in stored explanations (#186)", () => {
  beforeEach(async () => {
    await db
      .update(t.invoices)
      .set({ amountCents: 604750 })
      .where(eq(t.invoices.id, "inv_stored"));
  });
  it.each([
    "The amount is $6,047.50_000.",
    "The amount is $6,047.50×10^9.",
    "The amount is $6,047.50 000.",
    "The amount is $6,047.50\u202f000.",
    "The amount is 999999.00 NZD.",
    "The balance is − $6,047.50.",
    "The amount is 999999 × $6,047.50.",
  ])(
    "rejects legacy and captured unsupported amounts: %s",
    async (text) => {
      const { ToolExecutor } = await import("@/lib/agent/tools");
      const { buildRunEvidenceManifest } = await import("@/lib/agent/manifest");
      for (const captured of [false, true])
        for (const field of ["summary", "claim", "question"] as const) {
          const row = await stored({ legacy: !captured, [field]: text });
          if (captured) {
            const tools = new ToolExecutor(db, {
              clientId: "stored-client",
              asOf: "2026-10-20",
            });
            const response = await tools.getInvoice("inv_stored");
            const capture = buildRunEvidenceManifest({
              runId: row.run.id,
              clientId: "stored-client",
              asOf: "2026-10-20",
              toolResponses: [{ sequence: 1, tool: "get_invoice", response }],
              records: tools.evidence.recordsAtRun(),
            });
            await db.insert(t.agentEvidenceManifests).values({
              runId: row.run.id,
              clientId: "stored-client",
              asOfDate: "2026-10-20",
              validatorVersion: capture.body.validatorVersion,
              canonicalJson: capture.canonicalText,
              sha256: capture.digest,
            });
          }
          expect(await storedExplanationUsable(db, row)).toBe(false);
          const [original] = await db
            .select()
            .from(t.explanations)
            .where(eq(t.explanations.id, row.explanation.id));
          expect(original).toEqual(row.explanation);
        }
    },
    30_000,
  );
  it("continues to accept a grounded suffix amount with ordinary IDs and dates", async () => {
    const row = await stored({
      question: "Can you reconcile 6,047.50 NZD for inv_stored on 2026-10-01?",
    });
    expect(await storedExplanationUsable(db, row)).toBe(true);
  });
});
