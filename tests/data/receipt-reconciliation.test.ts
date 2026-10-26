import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { validateOutput } from "@/lib/agent/validator";
import { ToolExecutor } from "@/lib/agent/tools";
import {
  buildRunEvidenceManifest,
  verifyCapturedRunEvidence,
} from "@/lib/agent/manifest";
import { buildCheckContext } from "@/lib/checks/context";
import { canonicalJson, sha256 } from "@/lib/trust/canonical";
import { alreadyPaid } from "@/lib/checks/alreadyPaid";
import { receiptCents } from "@/lib/data/receipt-reconciliation";
import { createMemoryDb, type Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { getClientReceivablesAgeing } from "@/lib/queries/client-ageing";
import { clientBorrowingReview } from "@/lib/queries/client-borrowing-review";
import { syntheticPortfolioReviewPack } from "@/lib/queries/portfolio-review-pack";

const databases: Db[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.$client.close()));
});
const asOf = "2026-10-26";
async function fixture() {
  const db = await createMemoryDb();
  databases.push(db);
  await db.insert(t.clients).values(
    ["c1", "c2"].map((id) => ({
      id,
      name: id,
      industry: "services",
      advanceRateBps: 8000,
      facilityLimitCents: 1000000,
      paymentTermsDays: 30,
    })),
  );
  await db.insert(t.debtors).values(
    ["c1", "c2"].map((clientId) => ({
      id: "d" + clientId,
      clientId,
      name: "Debtor " + clientId,
      nzbn: "9429000000001",
      firstSeenDate: "2026-01-01",
      creditBand: "B" as const,
    })),
  );
  await db.insert(t.batches).values({
    id: "batch",
    clientId: "c1",
    submittedDate: asOf,
    status: "PENDING",
  });
  await db.insert(t.invoices).values({
    id: "inv",
    clientId: "c1",
    batchId: "batch",
    debtorId: "dc1",
    invoiceNumber: "I1",
    issueDate: "2026-09-01",
    dueDate: "2026-10-01",
    amountCents: 20000,
    description: "Synthetic",
  });
  await db.insert(t.ledgerEntries).values([
    {
      id: "l1",
      clientId: "c1",
      debtorId: "dc1",
      invoiceNumber: "I1",
      amountCents: 20000,
      issueDate: "2026-09-01",
      recordedDate: "2026-09-01",
    },
    {
      id: "l2",
      clientId: "c1",
      debtorId: "dc1",
      invoiceNumber: "I2",
      amountCents: 20000,
      issueDate: "2026-09-01",
      recordedDate: "2026-09-01",
    },
    {
      id: "future-secret",
      clientId: "c1",
      debtorId: "dc1",
      invoiceNumber: "FUTURE",
      amountCents: 20000,
      issueDate: "2026-11-01",
      recordedDate: "2026-11-01",
    },
    {
      id: "foreign-secret",
      clientId: "c2",
      debtorId: "dc2",
      invoiceNumber: "FOREIGN",
      amountCents: 20000,
      issueDate: "2026-09-01",
      recordedDate: "2026-09-01",
    },
  ]);
  await db.insert(t.bankTransactions).values({
    id: "bank",
    clientId: "c1",
    date: "2026-10-01",
    amountCents: 10000,
    counterpartyName: "Debtor c1",
    reference: "Synthetic",
  });
  await db.insert(t.receiptAllocations).values({
    bankTransactionId: "bank",
    ledgerEntryId: "l1",
    amountCents: 8000,
  });
  return db;
}
function tools(db: Db) {
  return new ToolExecutor(db, { clientId: "c1", asOf });
}
async function bankTool(executor: ToolExecutor) {
  return executor.getBankTransactions("dc1", "2026-01-01", asOf);
}

describe(
  "shared cash reconciliation and evidence isolation (#183, #187)",
  { timeout: 30_000 },
  () => {
    it.each(["l2", "future-secret", "foreign-secret"])(
      "rejects excess consumption hidden in %s in every financial consumer",
      async (ledgerEntryId) => {
        const db = await fixture();
        await db.insert(t.receiptAllocations).values({
          bankTransactionId: "bank",
          ledgerEntryId,
          amountCents: 8000,
        });
        for (const read of [
          () => getClientReceivablesAgeing(db, "c1", asOf),
          () => clientBorrowingReview(db, "c1", asOf),
          () => syntheticPortfolioReviewPack(db, asOf, "c1"),
          () => buildCheckContext(db, "inv"),
        ])
          await expect(read()).rejects.toThrow(/exceeds available cash/);
        const executor = tools(db);
        const response = await bankTool(executor);
        expect(response).toEqual({
          error: "Receipt allocation sources could not be reconciled",
        });
        expect(executor.evidence.ids()).toEqual([]);
        expect(JSON.stringify(response)).not.toContain(ledgerEntryId);
      },
    );
    it("fails closed for foreign ownership even when the cash total fits", async () => {
      const db = await fixture();
      await db.insert(t.receiptAllocations).values({
        bankTransactionId: "bank",
        ledgerEntryId: "foreign-secret",
        amountCents: 1000,
      });
      await expect(getClientReceivablesAgeing(db, "c1", asOf)).rejects.toThrow(
        /outside this client/,
      );
      const executor = tools(db);
      expect(await bankTool(executor)).toHaveProperty("error");
      expect(executor.evidence.ids()).toEqual([]);
    });
    it("validates debtor ownership on referenced ledgers", async () => {
      const db = await fixture();
      await db
        .update(t.ledgerEntries)
        .set({ debtorId: "dc2" })
        .where(eq(t.ledgerEntries.id, "l1"));
      await expect(buildCheckContext(db, "inv")).rejects.toThrow(
        /outside this client/,
      );
      expect(await bankTool(tools(db))).toHaveProperty("error");
    });
    it("rejects a foreign bank linked to a visible client invoice", async () => {
      const db = await fixture();
      await db.update(t.bankTransactions).set({ clientId: "c2" });
      await expect(getClientReceivablesAgeing(db, "c1", asOf)).rejects.toThrow(
        /outside this client/,
      );
      await expect(buildCheckContext(db, "inv")).rejects.toThrow(
        /outside this client/,
      );
    });
    it("does not admit a future allocation aggregate as monetary evidence", async () => {
      const db = await fixture();
      await db.insert(t.receiptAllocations).values({
        bankTransactionId: "bank",
        ledgerEntryId: "future-secret",
        amountCents: 1000,
      });
      const executor = tools(db);
      const response = await bankTool(executor);
      const claimed = validateOutput(
        JSON.stringify({
          summary: "The receipt has $90.00 allocated.",
          risk_level: "high",
          recommendation: "HOLD",
          questions_for_client: [],
          claims: [
            {
              text: "The receipt has $90.00 allocated.",
              evidence_ids: ["bank"],
            },
          ],
          cited_evidence_ids: ["bank"],
        }),
        executor.evidence,
      );
      expect(claimed.ok).toBe(false);
      expect(response).toEqual({
        error: "Receipt allocation sources are not visible at this review date",
      });
      expect(executor.evidence.ids()).toEqual([]);
      const transcript = buildRunEvidenceManifest({
        runId: "run",
        clientId: "c1",
        asOf,
        records: [],
        toolResponses: [
          { sequence: 1, tool: "get_bank_transactions", response },
        ],
      });
      expect(transcript.body.toolResponses[0].response).toEqual(response);
      expect(transcript.body.records).toEqual([]);
    });
    it("keeps valid partial cash and freezes self-contained proof", async () => {
      const db = await fixture();
      expect(
        (await getClientReceivablesAgeing(db, "c1", asOf))
          ?.totalOutstandingCents,
      ).toBe(32000);
      const context = await buildCheckContext(db, "inv");
      expect(alreadyPaid(context.invoice, context)).toBeNull();
      const executor = tools(db);
      const response = await bankTool(executor);
      expect(JSON.stringify(response)).not.toContain("future-secret");
      const record = executor.evidence.get("bank")!;
      expect(record.allocatedCents).toBe(8000);
      const input = {
        runId: "run",
        clientId: "c1",
        asOf,
        records: executor.evidence.recordsAtRun(),
        toolResponses: [
          { sequence: 1, tool: "get_bank_transactions", response },
        ],
      };
      const original = buildRunEvidenceManifest(input);
      await db.update(t.bankTransactions).set({ amountCents: 1 });
      expect(buildRunEvidenceManifest(input)).toEqual(original);
    });
    it("does not count or validate cash dated after the review", async () => {
      const db = await fixture();
      await db
        .update(t.bankTransactions)
        .set({ date: "2026-11-01", amountCents: 1 });
      expect(
        (await getClientReceivablesAgeing(db, "c1", asOf))
          ?.totalOutstandingCents,
      ).toBe(40000);
      expect((await buildCheckContext(db, "inv")).receiptAllocations).toEqual(
        [],
      );
      expect(await bankTool(tools(db))).toMatchObject({ transactions: [] });
    });
    it("rejects negative allocations and database-unrepresentable cents", async () => {
      const db = await fixture();
      await db.update(t.receiptAllocations).set({ amountCents: -1 });
      await expect(getClientReceivablesAgeing(db, "c1", asOf)).rejects.toThrow(
        /nonnegative safe integer/,
      );
      expect(await bankTool(tools(db))).toHaveProperty("error");
      await expect(
        db
          .update(t.receiptAllocations)
          .set({ amountCents: Number.MAX_SAFE_INTEGER + 1 }),
      ).rejects.toThrow();
      for (const amount of [
        Number.MAX_SAFE_INTEGER + 1,
        NaN,
        Infinity,
        0.5,
        -1,
      ])
        expect(() => receiptCents(amount)).toThrow();
    });
  },
);

describe("captured receipt relationship proof", () => {
  const allocation = {
    ledgerEntryId: "l1",
    amount: 80,
    ledger: {
      id: "l1",
      clientId: "c1",
      debtorClientId: "c1",
      issueDate: "2026-09-01",
      recordedDate: "2026-09-01",
    },
  };
  function manifest(record: Record<string, unknown>) {
    return buildRunEvidenceManifest({
      runId: "run",
      clientId: "c1",
      asOf,
      records: [
        {
          id: "bank",
          clientId: "c1",
          type: "bank_transaction",
          date: "2026-10-01",
          amount: 100,
          allocatedCents: 8000,
          allocations: [allocation],
          ...record,
        },
      ],
      toolResponses: [],
    });
  }
  it("rejects legacy nonempty nested IDs without original ownership proof", () => {
    expect(() =>
      manifest({
        allocations: [{ ledgerEntryId: "foreign-secret", amount: 80 }],
      }),
    ).toThrow(/Invalid captured receipt/);
    expect(() =>
      manifest({ allocations: [], allocatedCents: 0 }),
    ).not.toThrow();
  });
  it.each([
    {
      allocations: [
        { ...allocation, ledger: { ...allocation.ledger, clientId: "c2" } },
      ],
    },
    {
      allocations: [
        {
          ...allocation,
          ledger: { ...allocation.ledger, debtorClientId: "c2" },
        },
      ],
    },
    {
      allocations: [
        {
          ...allocation,
          ledger: { ...allocation.ledger, recordedDate: "2026-11-01" },
        },
      ],
    },
    {
      allocations: [
        {
          ...allocation,
          ledger: { ...allocation.ledger, issueDate: "2026-02-30" },
        },
      ],
    },
    { allocations: [{ ...allocation, amount: -1 }] },
    { allocations: [{ ...allocation, amount: 0.001 }] },
    { allocations: [{ ...allocation, amount: 0.8000000001 }] },
    { allocations: [{ ...allocation, amount: 101 }] },
    { allocations: [allocation, allocation] },
    { allocatedCents: 9000 },
    { allocatedCents: 10001 },
    { allocatedCents: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects malformed frozen relationships and money %#", (record) => {
    expect(() => manifest(record)).toThrow(/Invalid captured receipt/);
  });
});

it.each(["valid", "legacy", "foreign", "excess"])(
  "revalidates original stored %s cash captures without rewriting history",
  async (variant) => {
    const db = await fixture();
    const executor = tools(db);
    const response = await bankTool(executor);
    const body = buildRunEvidenceManifest({
      runId: "captured",
      clientId: "c1",
      asOf,
      records: executor.evidence.recordsAtRun(),
      toolResponses: [{ sequence: 1, tool: "get_bank_transactions", response }],
    }).body;
    const bank = body.records[0];
    const responseBank = (
      body.toolResponses[0].response as { transactions: typeof body.records }
    ).transactions[0];
    for (const record of [bank, responseBank]) {
      const allocation = (record.allocations as Record<string, unknown>[])[0];
      if (variant === "legacy") {
        delete allocation.ledger;
        delete record.allocatedCents;
        body.validatorVersion = "captured-evidence-v1";
      }
      if (variant === "foreign")
        (allocation.ledger as Record<string, unknown>).clientId = "c2";
      if (variant === "excess") record.allocatedCents = 10001;
    }
    const canonical = canonicalJson(body);
    const [run] = await db
      .insert(t.agentRuns)
      .values({
        id: "captured",
        subjectType: "INVOICE",
        subjectId: "inv",
        provider: "scripted",
        model: "test",
        promptVersion: "test",
        configVersion: "test",
        codeSha: "test",
        attempts: 1,
        status: "PASSED",
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: 0,
        asOfDate: asOf,
        evidenceManifestRequired: true,
      })
      .returning();
    const [explanation] = await db
      .insert(t.explanations)
      .values({
        id: "explanation",
        agentRunId: run.id,
        summary: "Review the receipt evidence.",
        riskLevel: "HIGH",
        recommendation: "HOLD",
        questionsForClient: [],
        claims: [
          { text: "The receipt requires review.", evidenceIds: ["bank"] },
        ],
        citedEvidenceIds: ["bank"],
        validationStatus: "PASSED",
        validationErrors: [],
      })
      .returning();
    await db.insert(t.agentEvidenceManifests).values({
      runId: run.id,
      clientId: "c1",
      asOfDate: asOf,
      validatorVersion: body.validatorVersion,
      canonicalJson: canonical,
      sha256: sha256(canonical),
    });
    // Frozen proof, not modern replacement: a current source edit cannot alter it.
    await db.update(t.bankTransactions).set({ amountCents: 1 });
    expect(await verifyCapturedRunEvidence(db, { run, explanation })).toBe(
      variant === "valid" ? "PASSED" : "FAILED",
    );
    const [saved] = await db.select().from(t.agentEvidenceManifests);
    expect(saved.canonicalJson).toBe(canonical);
    expect(saved.sha256).toBe(sha256(canonical));
  },
  30_000,
);
