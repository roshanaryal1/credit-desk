import "server-only";

import { and, asc, eq } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { requireAccess, type IdentityContext } from "@/lib/security/access";

import {
  transitionCase,
  type CaseAction,
  type CaseRole,
  type CreditCase,
} from "./case-machine";

export interface NewCaseInput {
  id: string;
  tenantId: string;
  clientId: string;
  subjectType: "INVOICE" | "INCIDENT";
  subjectId: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  dueDate: string | null;
}

function isoDate(value: string): void {
  const millis = Date.parse(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(millis) ||
    new Date(millis).toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Invalid case deadline business date");
  }
}

function date(value: string): Date {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error("Invalid UTC case event instant");
  }
  return new Date(value);
}

function fromDb(row: typeof t.creditCases.$inferSelect): CreditCase {
  return {
    caseId: row.id,
    clientId: row.clientId,
    state: row.state as CreditCase["state"],
    version: row.version,
    ownerId: row.ownerId,
    makerId: row.makerId,
    checkerId: row.checkerId,
    decisionReason: row.decisionReason,
  };
}

function actorForCase(actor: IdentityContext): {
  subjectId: string;
  roles: CaseRole[];
  clientIds: string[];
} {
  return {
    subjectId: actor.subject,
    roles: actor.roles.filter(
      (role): role is CaseRole =>
        role === "ANALYST" ||
        role === "CHECKER" ||
        role === "RISK_MANAGER" ||
        role === "AUDITOR",
    ),
    clientIds: actor.clientGrants,
  };
}

/**
 * Server-domain primitive only. IdentityContext MUST be constructed from a
 * cryptographically verified OIDC session by a future security adapter.
 * Existing shared-password prototype sessions are NOT eligible.
 */
export async function createCreditCase(
  db: Db,
  input: NewCaseInput,
  actor: IdentityContext,
  occurredAt: string,
): Promise<CreditCase> {
  const instant = date(occurredAt);
  requireAccess(
    actor,
    { tenantId: input.tenantId, clientId: input.clientId },
    "CASE_PROPOSE",
    instant.getTime(),
  );
  if (
    !input.id.trim() ||
    !input.subjectId.trim() ||
    !["INVOICE", "INCIDENT"].includes(input.subjectType) ||
    !["LOW", "MEDIUM", "HIGH"].includes(input.priority)
  ) {
    throw new Error("Invalid case source reference");
  }
  if (input.dueDate !== null) isoDate(input.dueDate);

  return db.transaction(async (tx) => {
    const [source] =
      input.subjectType === "INVOICE"
        ? await tx
            .select({ id: t.invoices.id })
            .from(t.invoices)
            .where(
              and(
                eq(t.invoices.id, input.subjectId),
                eq(t.invoices.clientId, input.clientId),
              ),
            )
            .limit(1)
        : await tx
            .select({ id: t.incidents.id })
            .from(t.incidents)
            .where(
              and(
                eq(t.incidents.id, input.subjectId),
                eq(t.incidents.clientId, input.clientId),
              ),
            )
            .limit(1);
    if (!source) throw new Error("Source record missing or belongs to another client");
    const [created] = await tx
      .insert(t.creditCases)
      .values({
        id: input.id,
        tenantId: input.tenantId,
        clientId: input.clientId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        priority: input.priority,
        dueDate: input.dueDate,
        state: "NEW",
        version: 0,
        updatedAt: instant,
      })
      .returning();
    await tx.insert(t.creditCaseEvents).values({
      id: `case-event:${input.id}:0`,
      caseId: input.id,
      fromState: null,
      toState: "NEW",
      version: 0,
      actorId: actor.subject,
      action: "CREATE",
      reason: null,
      occurredAt: instant,
    });
    return fromDb(created);
  });
}

/** Atomic compare-and-swap row update and append-only event in one transaction. */
export async function applyCreditCaseAction(
  db: Db,
  id: string,
  action: CaseAction,
  actor: IdentityContext,
  expectedVersion: number,
  occurredAt: string,
): Promise<CreditCase> {
  const instant = date(occurredAt);
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(t.creditCases)
      .where(eq(t.creditCases.id, id))
      .limit(1);
    if (!current) throw new Error("Case not found");

    const required =
      ["APPROVE", "HOLD", "REJECT", "RETURN"].includes(action.kind)
        ? "CASE_CHECK"
        : ["ASSIGN", "CLOSE", "REOPEN"].includes(action.kind)
          ? "POLICY_EDIT"
          : "CASE_PROPOSE";

    requireAccess(
      actor,
      { tenantId: current.tenantId, clientId: current.clientId },
      required,
      instant.getTime(),
    );

    const result = transitionCase(
      fromDb(current),
      action,
      actorForCase(actor),
      expectedVersion,
      occurredAt,
    );
    const [updated] = await tx
      .update(t.creditCases)
      .set({
        state: result.next.state,
        version: result.next.version,
        ownerId: result.next.ownerId,
        makerId: result.next.makerId,
        checkerId: result.next.checkerId,
        decisionReason: result.next.decisionReason,
        updatedAt: instant,
      })
      .where(
        and(
          eq(t.creditCases.id, id),
          eq(t.creditCases.tenantId, current.tenantId),
          eq(t.creditCases.clientId, current.clientId),
          eq(t.creditCases.version, expectedVersion),
          eq(t.creditCases.state, current.state),
        ),
      )
      .returning();
    if (!updated) throw new Error("Stale concurrent case decision");
    await tx.insert(t.creditCaseEvents).values({
      id: `case-event:${id}:${result.event.version}`,
      caseId: id,
      fromState: result.event.from,
      toState: result.event.to,
      version: result.event.version,
      actorId: result.event.actorId,
      action: result.event.action,
      reason: result.event.reason,
      occurredAt: instant,
    });
    return fromDb(updated);
  });
}

export async function readCreditCase(
  db: Db,
  id: string,
  actor: IdentityContext,
  now: Date,
) {
  if (Number.isNaN(now.getTime())) throw new Error("Invalid read time");
  const [row] = await db
    .select()
    .from(t.creditCases)
    .where(eq(t.creditCases.id, id))
    .limit(1);
  if (!row) return null;
  requireAccess(
    actor,
    { tenantId: row.tenantId, clientId: row.clientId },
    "CASE_READ",
    now.getTime(),
  );
  return fromDb(row);
}

export async function creditCaseHistory(
  db: Db,
  id: string,
  actor: IdentityContext,
  now: Date,
) {
  await readCreditCase(db, id, actor, now);
  const rows = await db
    .select()
    .from(t.creditCaseEvents)
    .where(eq(t.creditCaseEvents.caseId, id))
    .orderBy(asc(t.creditCaseEvents.version));
  return rows;
}
