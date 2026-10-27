import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONFIG_VERSION } from "@/lib/checks/config";
import { createMemoryDb, type Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { getInvoiceReview } from "@/lib/queries/invoice";
import { canonicalJson, sha256 } from "@/lib/trust/canonical";
import { saveDecision, type DecisionInput } from "@/lib/trust/decide";
import { reviewState } from "@/lib/trust/review";
import { buildSnapshot, verifySnapshot } from "@/lib/trust/snapshot";

let db: Db;
const invoiceId = "inv_review_integrity";
const analyst = {
  sessionId: "review-integrity",
  displayName: "Fictional reviewer",
  mode: "SHADOW" as const,
};

beforeEach(async () => {
  db = await createMemoryDb();
  await db.insert(t.clients).values({
    id: "review-client",
    name: "Fictional review borrower",
    industry: "services",
    facilityLimitCents: 1000000,
    advanceRateBps: 8000,
    paymentTermsDays: 30,
  });
  await db.insert(t.debtors).values({
    id: "review-debtor",
    clientId: "review-client",
    name: "Fictional debtor",
    nzbn: "9429000000001",
    firstSeenDate: "2026-01-01",
    creditBand: "A",
  });
  await db.insert(t.batches).values({
    id: "review-batch",
    clientId: "review-client",
    submittedDate: "2026-10-20",
    status: "PENDING",
  });
  await db.insert(t.invoices).values({
    id: invoiceId,
    batchId: "review-batch",
    clientId: "review-client",
    debtorId: "review-debtor",
    invoiceNumber: "REVIEW-1",
    issueDate: "2026-10-01",
    dueDate: "2026-10-31",
    amountCents: 100000,
    description: "Fictional review service",
  });
  await db.insert(t.ledgerEntries).values({
    id: "review-ledger",
    clientId: "review-client",
    debtorId: "review-debtor",
    invoiceNumber: "REVIEW-1",
    issueDate: "2026-10-01",
    recordedDate: "2026-10-01",
    amountCents: 90000,
  });
  await db.insert(t.ledgerStatusEvents).values({
    ledgerEntryId: "review-ledger",
    effectiveDate: "2026-10-01",
    status: "AUTHORISED",
  });
  await db.insert(t.bankTransactions).values({
    id: "review-bank",
    clientId: "review-client",
    date: "2026-10-19",
    amountCents: 40000,
    counterpartyName: "Fictional debtor",
    reference: "Fictional receipt",
  });
  await db.insert(t.receiptAllocations).values({
    bankTransactionId: "review-bank",
    ledgerEntryId: "review-ledger",
    amountCents: 20000,
  });
  await db.insert(t.findings).values({
    id: "review-finding",
    invoiceId,
    checkId: "LEDGER_MISMATCH",
    severity: "HIGH",
    details: {
      submittedCents: 100000,
      ledgerCents: 90000,
      evidenceIds: [invoiceId, "review-ledger", "review-bank"],
    },
    configVersion: CONFIG_VERSION,
  });
}, 90000);

afterEach(async () => {
  await db?.$client.close();
}, 90000);

async function input(key = randomUUID()): Promise<DecisionInput> {
  return {
    invoiceId,
    decision: "APPROVE",
    reason: "",
    reviewVersion: (await reviewState(db, invoiceId)).version,
    idempotencyKey: key,
  };
}

async function expectNoHistory() {
  expect(await db.select().from(t.decisions)).toHaveLength(0);
  expect(await db.select().from(t.decisionSnapshots)).toHaveLength(0);
  expect(await db.select().from(t.auditEvents)).toHaveLength(0);
}

it("rejects excess bank evidence outside the invoice receipt context", async () => {
  await db
    .update(t.ledgerEntries)
    .set({ invoiceNumber: "UNRELATED-SYNTHETIC" })
    .where(eq(t.ledgerEntries.id, "review-ledger"));
  await db
    .update(t.receiptAllocations)
    .set({ amountCents: 40001 })
    .where(eq(t.receiptAllocations.bankTransactionId, "review-bank"));
  await expect(
    getInvoiceReview(invoiceId, analyst, "review-batch", true, db),
  ).rejects.toThrow(/exceeds available cash/);
  await expectNoHistory();
});

const mutations: [string, () => Promise<unknown>][] = [
  [
    "invoice financial value",
    () =>
      db
        .update(t.invoices)
        .set({ amountCents: 99999900 })
        .where(eq(t.invoices.id, invoiceId)),
  ],
  [
    "invoice description",
    () =>
      db
        .update(t.invoices)
        .set({ description: "Changed reviewed service" })
        .where(eq(t.invoices.id, invoiceId)),
  ],
  [
    "debtor identity shown in the panel",
    () =>
      db
        .update(t.debtors)
        .set({ name: "Another fictional debtor" })
        .where(eq(t.debtors.id, "review-debtor")),
  ],
  [
    "facility policy",
    () =>
      db
        .update(t.clients)
        .set({ facilityLimitCents: 1000 })
        .where(eq(t.clients.id, "review-client")),
  ],
  [
    "finding details without changing its ID/severity",
    () =>
      db
        .update(t.findings)
        .set({
          details: { submittedCents: 99999900, evidenceIds: [invoiceId] },
        })
        .where(eq(t.findings.id, "review-finding")),
  ],
  [
    "ledger amount",
    () =>
      db
        .update(t.ledgerEntries)
        .set({ amountCents: 85000 })
        .where(eq(t.ledgerEntries.id, "review-ledger")),
  ],
  [
    "bank evidence reference",
    () =>
      db
        .update(t.bankTransactions)
        .set({ reference: "Changed receipt source" })
        .where(eq(t.bankTransactions.id, "review-bank")),
  ],
  [
    "receipt allocation",
    () =>
      db
        .update(t.receiptAllocations)
        .set({ amountCents: 25000 })
        .where(eq(t.receiptAllocations.bankTransactionId, "review-bank")),
  ],
  [
    "new source credit-note phantom",
    () =>
      db.insert(t.creditNotes).values({
        id: "review-credit",
        ledgerEntryId: "review-ledger",
        date: "2026-10-19",
        amountCents: 5000,
      }),
  ],
  [
    "new status-event phantom",
    () =>
      db.insert(t.ledgerStatusEvents).values({
        ledgerEntryId: "review-ledger",
        effectiveDate: "2026-10-19",
        status: "PAID",
      }),
  ],
  [
    "new funding phantom",
    () =>
      db.insert(t.fundings).values({
        id: "review-funding",
        invoiceId,
        fundedDate: "2026-10-19",
        advanceCents: 70000,
      }),
  ],
];

describe("reviewed financial state (#182)", () => {
  it.each(mutations)(
    "rejects changed %s without appending history",
    async (_name, mutate) => {
      const submitted = await input();
      await mutate();
      expect((await reviewState(db, invoiceId)).version).not.toBe(
        submitted.reviewVersion,
      );
      expect(
        await saveDecision(db, submitted, analyst, { codeSha: "test" }),
      ).toMatchObject({ ok: false, reason: "STALE" });
      await expectNoHistory();
    },
    90000,
  );

  it("binds the actual rendered panel and evidence to the canonical snapshot", async () => {
    const panel = await getInvoiceReview(
      invoiceId,
      analyst,
      "review-batch",
      true,
      db,
    );
    expect(panel?.invoice.amountCents).toBe(100000);
    expect(panel?.evidence.get("review-ledger")?.facts).toContain("$900.00");
    const submitted = {
      ...(await input()),
      reviewVersion: panel!.reviewVersion,
    };
    const result = await saveDecision(db, submitted, analyst, {
      codeSha: "test",
    });
    if (!result.ok) throw Error(result.message);
    const [snapshot] = await db.select().from(t.decisionSnapshots);
    const frozen = JSON.parse(snapshot.canonicalJson);
    expect(frozen.schemaVersion).toBe(4);
    expect(sha256(canonicalJson(frozen.reviewedState))).toBe(
      panel?.reviewVersion,
    );
    expect(frozen.reviewedStateSha256).toBe(submitted.reviewVersion);
    expect(frozen.reviewedState.panel.invoice).toEqual(panel?.invoice);
    expect(frozen.reviewedState.findings).toEqual(
      JSON.parse(JSON.stringify(panel?.findings)),
    );
    expect(frozen.checkContext.invoice.amountCents).toBe(
      panel?.invoice.amountCents,
    );
    expect(frozen.reviewedState.evidence["review-ledger"].amountCents).toBe(
      90000,
    );
    expect(await verifySnapshot(db, result.decisionId)).toEqual({
      checksumMatches: true,
      chainMatches: true,
    });
  }, 90000);

  it("does not re-fetch financial sources while freezing a validated state", async () => {
    const submitted = await input();
    // Real SQL trigger changes the source at the decision insert boundary.
    // The frozen body must remain the exact state already validated, never a mixture.
    await db.execute(
      sql`create function change_review_source() returns trigger language plpgsql as $$ begin update invoices set amount_cents = 88888800 where id = 'inv_review_integrity'; return new; end $$`,
    );
    await db.execute(
      sql`create trigger change_review_source before insert on decisions for each row execute function change_review_source()`,
    );
    const saved = await saveDecision(db, submitted, analyst, {
      codeSha: "test",
    });
    if (!saved.ok) throw Error(saved.message);
    const [snapshot] = await db.select().from(t.decisionSnapshots);
    const frozen = JSON.parse(snapshot.canonicalJson);
    const [current] = await db
      .select()
      .from(t.invoices)
      .where(eq(t.invoices.id, invoiceId));
    expect(current.amountCents).toBe(88888800);
    expect(frozen.checkContext.invoice.amountCents).toBe(100000);
    expect(frozen.reviewedState.panel.invoice.amountCents).toBe(100000);
    expect(sha256(canonicalJson(frozen.reviewedState))).toBe(
      submitted.reviewVersion,
    );
  }, 90000);
});

describe("full submission UUID decision IDs (#185)", () => {
  it("saves different full UUIDs with the same prefix and preserves exact retries", async () => {
    const first = await input("decafbad-0000-4000-8000-000000000001");
    const a = await saveDecision(db, first, analyst, { codeSha: "test" });
    if (!a.ok) throw Error(a.message);
    const [original] = await db
      .select()
      .from(t.decisionSnapshots)
      .where(eq(t.decisionSnapshots.decisionId, a.decisionId));
    const second = await input("decafbad-1111-4111-8111-000000000002");
    const b = await saveDecision(db, second, analyst, { codeSha: "test" });
    if (!b.ok) throw Error(b.message);
    expect(a.decisionId).not.toBe(b.decisionId);
    expect(a.decisionId).toContain(first.idempotencyKey);
    expect(b.decisionId).toContain(second.idempotencyKey);
    await db
      .update(t.invoices)
      .set({ amountCents: 12345600 })
      .where(eq(t.invoices.id, invoiceId));
    expect(await saveDecision(db, first, analyst, { codeSha: "test" })).toEqual(
      { ...a, duplicate: true },
    );
    expect(await db.select().from(t.decisions)).toHaveLength(2);
    expect(await db.select().from(t.auditEvents)).toHaveLength(2);
    expect(
      (
        await db
          .select()
          .from(t.decisionSnapshots)
          .where(eq(t.decisionSnapshots.decisionId, a.decisionId))
      )[0],
    ).toEqual(original);
    expect(await verifySnapshot(db, b.decisionId)).toEqual({
      checksumMatches: true,
      chainMatches: true,
    });
  }, 90000);

  it("returns historical shortened IDs without rewriting an existing snapshot", async () => {
    const submitted = await input();
    const state = await reviewState(db, invoiceId);
    const historicalId = `dec_${submitted.idempotencyKey.slice(0, 8)}_${invoiceId}`;
    const [decision] = await db
      .insert(t.decisions)
      .values({
        id: historicalId,
        invoiceId,
        decision: submitted.decision,
        reason: submitted.reason,
        analystSessionId: analyst.sessionId,
        analystDisplayName: analyst.displayName,
        mode: analyst.mode,
        explanationIdAtDecision: null,
        aiContentExposedBeforeDecision: false,
        reviewVersion: submitted.reviewVersion,
        idempotencyKey: submitted.idempotencyKey,
        simulated: false,
        decidedAt: new Date(),
      })
      .returning();
    const oldShape = Object.fromEntries(
      Object.entries(
        buildSnapshot(state, { invoiceId, decision, codeSha: "old-version" }),
      ).filter(
        ([key]) => !["reviewedState", "reviewedStateSha256"].includes(key),
      ),
    );
    const canonical = canonicalJson({ ...oldShape, schemaVersion: 3 });
    await db.insert(t.decisionSnapshots).values({
      decisionId: historicalId,
      canonicalJson: canonical,
      sha256: sha256(canonical),
      prevSha256: null,
      schemaVersion: 3,
    });
    expect(
      await saveDecision(db, submitted, analyst, { codeSha: "test" }),
    ).toEqual({ ok: true, duplicate: true, decisionId: historicalId });
    expect((await db.select().from(t.decisionSnapshots))[0].canonicalJson).toBe(
      canonical,
    );
  }, 90000);
});

it("retries a real database serialization abort without duplicating history", async () => {
  const submitted = await input();
  await db.execute(sql`create sequence review_conflict_attempts`);
  await db.execute(
    sql`create function serialize_review_insert() returns trigger language plpgsql as $$ begin if nextval('review_conflict_attempts') = 1 then raise exception using errcode = '40001', message = 'Synthetic serialization conflict'; end if; return new; end $$`,
  );
  await db.execute(
    sql`create trigger serialize_review_insert before insert on decisions for each row execute function serialize_review_insert()`,
  );
  expect(
    (await saveDecision(db, submitted, analyst, { codeSha: "test" })).ok,
  ).toBe(true);
  expect(await db.select().from(t.decisions)).toHaveLength(1);
  expect(await db.select().from(t.decisionSnapshots)).toHaveLength(1);
  expect(await db.select().from(t.auditEvents)).toHaveLength(1);
  expect(
    (
      await db.execute<{ last_value: number }>(
        sql`select last_value from review_conflict_attempts`,
      )
    ).rows[0].last_value,
  ).toBe(2);
}, 90000);

it("fails closed after the bounded serialization retry budget", async () => {
  const submitted = await input();
  await db.execute(sql`create sequence review_conflict_attempts`);
  await db.execute(
    sql`create function serialize_review_insert() returns trigger language plpgsql as $$ begin perform nextval('review_conflict_attempts'); raise exception using errcode = '40001', message = 'Synthetic persistent serialization conflict'; end $$`,
  );
  await db.execute(
    sql`create trigger serialize_review_insert before insert on decisions for each row execute function serialize_review_insert()`,
  );
  expect(
    await saveDecision(db, submitted, analyst, { codeSha: "test" }),
  ).toMatchObject({ ok: false, reason: "STALE" });
  await expectNoHistory();
  expect(
    (
      await db.execute<{ last_value: number }>(
        sql`select last_value from review_conflict_attempts`,
      )
    ).rows[0].last_value,
  ).toBe(3);
}, 90000);
