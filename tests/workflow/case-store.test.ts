import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createMemoryDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import {
  applyCreditCaseAction,
  createCreditCase,
  creditCaseHistory,
  readCreditCase,
} from "@/lib/workflow/case-store";
import type { IdentityContext } from "@/lib/security/access";

const instant = "2026-10-24T08:00:00Z";
const now = new Date(instant);
const trusted: IdentityContext = {
  subject: "analyst-a",
  tenantId: "tenant-one",
  clientGrants: ["client-one"],
  roles: ["ANALYST", "CHECKER"],
  mfaSatisfied: false,
  issuer: "https://id.test.example",
  authenticatedUntilMs: 2_000_000_000_000,
};
const manager: IdentityContext = {
  ...trusted,
  subject: "manager-a",
  roles: ["RISK_MANAGER"],
  mfaSatisfied: true,
};
const checker: IdentityContext = {
  ...trusted,
  subject: "checker-b",
  roles: ["CHECKER"],
  mfaSatisfied: true,
};

async function seeded() {
  const db = await createMemoryDb();
  await db.insert(t.clients).values([
    {
      id: "client-one",
      name: "Synthetic one",
      industry: "retail",
      facilityLimitCents: 400_000,
      paymentTermsDays: 30,
    },
    {
      id: "client-two",
      name: "Synthetic two",
      industry: "logistics",
      facilityLimitCents: 250_000,
      paymentTermsDays: 30,
    },
  ]);
  await db.insert(t.debtors).values({
    id: "debtor-one",
    clientId: "client-one",
    name: "Test debtor",
    nzbn: "9429000000001",
    firstSeenDate: "2026-01-01",
    creditBand: "A",
  });
  await db.insert(t.batches).values({
    id: "batch-one",
    clientId: "client-one",
    submittedDate: "2026-10-23",
    status: "PENDING",
  });
  await db.insert(t.invoices).values({
    id: "invoice-one",
    batchId: "batch-one",
    clientId: "client-one",
    debtorId: "debtor-one",
    invoiceNumber: "INV-ONE",
    issueDate: "2026-10-01",
    dueDate: "2026-11-01",
    amountCents: 20_000,
    description: "Synthetic invoice",
  });
  return db;
}

async function create(db: Awaited<ReturnType<typeof seeded>>) {
  return createCreditCase(
    db,
    {
      id: "case-one",
      tenantId: "tenant-one",
      clientId: "client-one",
      subjectType: "INVOICE",
      subjectId: "invoice-one",
      priority: "HIGH",
      dueDate: "2026-10-28",
    },
    trusted,
    instant,
  );
}

describe("persisted case and independent checker controls", () => {
  it("records transactional case history and separates the maker/checker", async () => {
    const db = await seeded();
    expect((await create(db)).state).toBe("NEW");
    await applyCreditCaseAction(
      db,
      "case-one",
      { kind: "ASSIGN", ownerId: "analyst-a" },
      manager,
      0,
      instant,
    );
    await applyCreditCaseAction(
      db,
      "case-one",
      { kind: "START" },
      trusted,
      1,
      instant,
    );
    await applyCreditCaseAction(
      db,
      "case-one",
      { kind: "SUBMIT_FOR_CHECK" },
      trusted,
      2,
      instant,
    );
    await expect(
      applyCreditCaseAction(
        db,
        "case-one",
        { kind: "APPROVE", reason: "Reviewed against evidence" },
        { ...trusted, mfaSatisfied: true },
        3,
        instant,
      ),
    ).rejects.toThrow(/different verified identities/);

    const approved = await applyCreditCaseAction(
      db,
      "case-one",
      { kind: "APPROVE", reason: "Verified original evidence" },
      checker,
      3,
      instant,
    );
    expect(approved).toMatchObject({
      state: "APPROVED",
      version: 4,
      makerId: "analyst-a",
      checkerId: "checker-b",
    });
    const events = await creditCaseHistory(db, "case-one", manager, now);
    expect(events.map((event) => event.version)).toEqual([0, 1, 2, 3, 4]);
    expect(events.at(-1)).toMatchObject({
      toState: "APPROVED",
      actorId: "checker-b",
    });
    await expect(
      db.delete(t.creditCaseEvents).where(eq(t.creditCaseEvents.caseId, "case-one")),
    ).rejects.toThrow();
    expect(await creditCaseHistory(db, "case-one", manager, now)).toHaveLength(5);
  }, 60_000);

  it("rejects stale transitions and records no duplicate decision events", async () => {
    const db = await seeded();
    await create(db);
    const first = await applyCreditCaseAction(
      db,
      "case-one",
      { kind: "ASSIGN", ownerId: "analyst-a" },
      manager,
      0,
      instant,
    );
    expect(first.version).toBe(1);
    await expect(
      applyCreditCaseAction(
        db,
        "case-one",
        { kind: "ASSIGN", ownerId: "another-user" },
        manager,
        0,
        instant,
      ),
    ).rejects.toThrow(/Stale case version/);
    const events = await creditCaseHistory(db, "case-one", manager, now);
    expect(events).toHaveLength(2);
  });

  it("fails closed when the subject belongs to a different client", async () => {
    const db = await seeded();
    await expect(
      createCreditCase(
        db,
        {
          id: "case-wrong",
          tenantId: "tenant-one",
          clientId: "client-two",
          subjectType: "INVOICE",
          subjectId: "invoice-one",
          priority: "MEDIUM",
          dueDate: null,
        },
        {
          ...trusted,
          clientGrants: ["client-one", "client-two"],
        },
        instant,
      ),
    ).rejects.toThrow(/outside|another client/);
  });

  it("enforces MFA, trusted tenant/client scope and session expiry on reads", async () => {
    const db = await seeded();
    await create(db);
    await expect(
      applyCreditCaseAction(
        db,
        "case-one",
        { kind: "ASSIGN", ownerId: "analyst-a" },
        { ...manager, mfaSatisfied: false },
        0,
        instant,
      ),
    ).rejects.toThrow(/MFA_REQUIRED/);
    await expect(
      readCreditCase(
        db,
        "case-one",
        { ...trusted, tenantId: "other-tenant" },
        now,
      ),
    ).rejects.toThrow(/TENANT_BOUNDARY/);
    await expect(
      readCreditCase(
        db,
        "case-one",
        { ...trusted, clientGrants: [] },
        now,
      ),
    ).rejects.toThrow(/CLIENT_BOUNDARY/);
    await expect(
      readCreditCase(
        db,
        "case-one",
        { ...trusted, authenticatedUntilMs: 0 },
        now,
      ),
    ).rejects.toThrow(/EXPIRED/);
  });
});
