import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { createMemoryDb, type Db } from "@/lib/db/client";
import {
  APPEND_ONLY_TABLES,
  auditEvents,
  clients,
  debtors,
  ledgerEntries,
} from "@/lib/db/schema";

let db: Db;

beforeAll(async () => {
  db = await createMemoryDb();
  await db.insert(clients).values({
    id: "cli_01",
    name: "Harbourline Freight",
    industry: "logistics",
    facilityLimitCents: 50_000_000,
    paymentTermsDays: 30,
  });
  await db.insert(debtors).values({
    id: "dbt_01",
    clientId: "cli_01",
    name: "Kowhai Retail",
    nzbn: "9429000000001",
    firstSeenDate: "2025-01-01",
    creditBand: "B",
  });
});

describe("schema", () => {
  it("applies migrations and defaults the advance rate to 80%", async () => {
    const [row] = await db
      .select()
      .from(clients)
      .where(eq(clients.id, "cli_01"));
    expect(row?.advanceRateBps).toBe(8000);
  });

  it("keeps ledger invoice numbers unique per client", async () => {
    const entry = {
      clientId: "cli_01",
      invoiceNumber: "INV-1001",
      debtorId: "dbt_01",
      amountCents: 100_00,
      issueDate: "2026-09-01",
      recordedDate: "2026-09-01",
    };
    await db.insert(ledgerEntries).values({ id: "led_01", ...entry });
    await expect(
      db.insert(ledgerEntries).values({ id: "led_02", ...entry }),
    ).rejects.toThrow();
  });

  it("lists the append-only tables from the spec", () => {
    expect([...APPEND_ONLY_TABLES].sort()).toEqual(
      [
        "agent_runs",
        "agent_evidence_manifests",
        "audit_events",
        "decisions",
        "decision_snapshots",
        "explanations",
        "incident_events",
        "ingestion_events",
        "credit_case_events",
      ].sort(),
    );
  });

  it.each(APPEND_ONLY_TABLES)("rejects TRUNCATE on %s", async (table) => {
    // CASCADE reaches the trigger even when another table has an inbound FK.
    await expect(
      db.execute(sql`TRUNCATE public.${sql.identifier(table)} CASCADE`),
    ).rejects.toMatchObject({
      cause: { code: "P0001", message: `table ${table} is append-only` },
    });
  });

  it("keeps the guard effective for a non-owner granted TRUNCATE", async () => {
    await db.execute(sql`CREATE ROLE truncate_writer`);
    await db.execute(
      sql`GRANT TRUNCATE ON public.audit_events TO truncate_writer`,
    );
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE truncate_writer`);
        await tx.execute(sql`TRUNCATE public.audit_events`);
      }),
    ).rejects.toMatchObject({
      cause: { code: "P0001", message: "table audit_events is append-only" },
    });
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE truncate_writer`);
        await tx.execute(
          sql`ALTER TABLE public.audit_events DISABLE TRIGGER reject_truncate`,
        );
      }),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("rejects UPDATE and DELETE on append-only tables", async () => {
    await db.insert(auditEvents).values({
      id: "aud_01",
      actor: "test",
      action: "TEST",
      entityType: "test",
      entityId: "x",
      payload: {},
    });
    await expect(
      db
        .update(auditEvents)
        .set({ action: "CHANGED" })
        .where(eq(auditEvents.id, "aud_01")),
    ).rejects.toThrow();
    await expect(
      db.delete(auditEvents).where(eq(auditEvents.id, "aud_01")),
    ).rejects.toThrow();
    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.id, "aud_01"));
    expect(rows[0]?.action).toBe("TEST");
  });
});
