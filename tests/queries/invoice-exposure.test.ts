import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { CONFIG_VERSION } from "@/lib/checks/config";
import { createMemoryDb, type Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { getInvoiceReview } from "@/lib/queries/invoice";
import { saveDecision, type Analyst } from "@/lib/trust/decide";
import { reviewState } from "@/lib/trust/review";
import { verifySnapshot } from "@/lib/trust/snapshot";

let db: Db;
vi.mock("@/lib/db/client", async (original) => ({
  ...(await original<typeof import("@/lib/db/client")>()),
  getDb: () => Promise.resolve(db),
}));

const invoiceId = "inv_exposure_review";
const batchId = "batch_exposure_review";
const analyst: Analyst = {
  sessionId: "private-shadow-exposure",
  displayName: "Synthetic analyst",
  mode: "SHADOW",
};

async function seed() {
  db = await createMemoryDb();
  await db.insert(t.clients).values({
    id: "client_exposure",
    name: "Fictional credit client",
    industry: "services",
    facilityLimitCents: 1_000_000,
    paymentTermsDays: 30,
  });
  await db.insert(t.debtors).values({
    id: "debtor_exposure",
    clientId: "client_exposure",
    name: "Fictional debtor",
    nzbn: "9429000000001",
    firstSeenDate: "2026-01-01",
    creditBand: "A",
  });
  await db.insert(t.batches).values({
    id: batchId,
    clientId: "client_exposure",
    submittedDate: "2026-10-20",
    status: "PENDING",
  });
  await db.insert(t.invoices).values([
    {
      id: invoiceId,
      batchId,
      clientId: "client_exposure",
      debtorId: "debtor_exposure",
      invoiceNumber: "EXPOSURE-1",
      issueDate: "2026-10-01",
      dueDate: "2026-10-31",
      amountCents: 100_000,
      description: "Fictional invoice for review",
    },
    {
      id: "inv_invalid_exposure",
      batchId,
      clientId: "client_exposure",
      debtorId: "debtor_exposure",
      invoiceNumber: "EXPOSURE-2",
      issueDate: "2026-10-01",
      dueDate: "2026-10-31",
      amountCents: 200_000,
      description: "Fictional invalid explanation",
    },
  ]);
  await db.insert(t.agentRuns).values([
    {
      id: "run_exposure_valid",
      subjectType: "INVOICE",
      subjectId: invoiceId,
      provider: "test",
      model: "recorded",
      promptVersion: "test",
      configVersion: CONFIG_VERSION,
      codeSha: "test",
      attempts: 1,
      status: "PASSED",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
      asOfDate: "2026-10-20",
    },
    {
      id: "run_exposure_invalid",
      subjectType: "INVOICE",
      subjectId: "inv_invalid_exposure",
      provider: "test",
      model: "recorded",
      promptVersion: "test",
      configVersion: CONFIG_VERSION,
      codeSha: "test",
      attempts: 1,
      status: "PASSED",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
      asOfDate: "2026-10-20",
    },
  ]);
  await db.insert(t.explanations).values([
    {
      id: "exp_exposure_valid",
      agentRunId: "run_exposure_valid",
      summary: "Review the cited evidence.",
      riskLevel: "MEDIUM",
      recommendation: "HOLD",
      questionsForClient: ["Please provide the supporting records."],
      claims: [{ text: "This record needs review.", evidenceIds: [invoiceId] }],
      citedEvidenceIds: [invoiceId],
      validationStatus: "PASSED",
      validationErrors: [],
    },
    {
      id: "exp_exposure_invalid",
      agentRunId: "run_exposure_invalid",
      summary: "Unusable output.",
      riskLevel: "MEDIUM",
      recommendation: "HOLD",
      questionsForClient: [],
      claims: [
        {
          text: "This record needs review.",
          evidenceIds: ["inv_invalid_exposure"],
        },
      ],
      citedEvidenceIds: ["inv_invalid_exposure"],
      validationStatus: "FAILED",
      validationErrors: ["synthetic validation failure"],
    },
  ]);
}

async function sessionExposures(sessionId: string) {
  return db
    .select()
    .from(t.exposures)
    .where(eq(t.exposures.sessionId, sessionId));
}

async function decision() {
  const result = await saveDecision(
    db,
    {
      invoiceId,
      decision: "HOLD",
      reason: "Fictional supporting documents missing",
      reviewVersion: (await reviewState(db, invoiceId)).version,
      idempotencyKey: randomUUID(),
    },
    analyst,
    { codeSha: "test" },
  );
  if (!result.ok) throw new Error(result.message);
  return result.decisionId;
}

describe("SHADOW revision exposure (#166)", () => {
  it("records revisions but not blind or public exposure", async () => {
    await seed();

    const initial = await getInvoiceReview(invoiceId, analyst, batchId);
    expect(initial?.withheld).toBe(true);
    expect(initial?.explanation).toBeNull();
    expect(await sessionExposures(analyst.sessionId)).toHaveLength(0);

    // Even if output is shown to a public/read-only persona, the session
    // cannot make a decision and must not acquire a writable exposure record.
    const publicAnalyst: Analyst = {
      ...analyst,
      sessionId: "public-read-only",
    };
    const publicReview = await getInvoiceReview(
      invoiceId,
      publicAnalyst,
      batchId,
      true,
    );
    expect(publicReview?.explanation?.explanation.id).toBe(
      "exp_exposure_valid",
    );
    expect(await sessionExposures(publicAnalyst.sessionId)).toHaveLength(0);

    // Private ASSIST mode still records delivery before any first decision.
    const assist: Analyst = {
      ...analyst,
      sessionId: "private-assist-exposure",
      mode: "ASSIST",
    };
    expect(
      (await getInvoiceReview(invoiceId, assist, batchId))?.explanation,
    ).not.toBeNull();
    expect(await sessionExposures(assist.sessionId)).toHaveLength(1);
    await getInvoiceReview(invoiceId, assist, batchId);
    expect(await sessionExposures(assist.sessionId)).toHaveLength(1);

    // The first SHADOW decision is blind.
    const first = await decision();
    const [firstRow] = await db
      .select()
      .from(t.decisions)
      .where(eq(t.decisions.id, first));
    expect(firstRow.aiContentExposedBeforeDecision).toBe(false);

    // After that decision, SHADOW may reveal a validated explanation;
    // a subsequent revision must be marked as exposed.
    const revealed = await getInvoiceReview(invoiceId, analyst, batchId);
    expect(revealed?.withheld).toBe(false);
    expect(revealed?.explanation?.explanation.id).toBe("exp_exposure_valid");
    expect(await sessionExposures(analyst.sessionId)).toHaveLength(1);
    await getInvoiceReview(invoiceId, analyst, batchId);
    expect(await sessionExposures(analyst.sessionId)).toHaveLength(1);

    const revised = await decision();
    const [revision] = await db
      .select()
      .from(t.decisions)
      .where(eq(t.decisions.id, revised));
    expect(revision.aiContentExposedBeforeDecision).toBe(true);
    const [snapshot] = await db
      .select()
      .from(t.decisionSnapshots)
      .where(eq(t.decisionSnapshots.decisionId, revised));
    const frozen = JSON.parse(snapshot.canonicalJson) as {
      decision: { aiContentExposedBeforeDecision: boolean };
    };
    expect(frozen.decision.aiContentExposedBeforeDecision).toBe(true);
    expect(await verifySnapshot(db, revised)).toEqual({
      checksumMatches: true,
      chainMatches: true,
    });

    // Invalid explanations and wrong-batch routes never create an exposure.
    const failedAnalyst: Analyst = {
      ...analyst,
      sessionId: "failed-or-wrong-route",
      mode: "ASSIST",
    };
    const invalid = await getInvoiceReview(
      "inv_invalid_exposure",
      failedAnalyst,
      batchId,
    );
    expect(invalid?.explanation).toBeNull();
    expect(
      await getInvoiceReview(invoiceId, failedAnalyst, "wrong-batch"),
    ).toBeNull();
    expect(await sessionExposures(failedAnalyst.sessionId)).toHaveLength(0);

    // Read-only delivery remains excluded even after an existing decision.
    await getInvoiceReview(invoiceId, publicAnalyst, batchId, true);
    expect(await sessionExposures(publicAnalyst.sessionId)).toHaveLength(0);
  }, 60_000);
});
