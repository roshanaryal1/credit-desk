import "server-only";

import { and, asc, eq, inArray, lte } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { addDays } from "@/lib/dates";
import { nzBusinessDateAt } from "@/lib/watch/as-of-events";
import {
  sourceHealth,
  type SourceHealth,
  type SourceKind,
} from "@/lib/data/observations";

function checked(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(label + " must be nonnegative safe integer NZD cents");
  }
}
function sum(values: number[]) {
  const total = values.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(total))
    throw new Error("Source reconciliation overflow");
  return total;
}
function validDay(asOf: string) {
  const ms = Date.parse(asOf + "T00:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
    !Number.isFinite(ms) ||
    new Date(ms).toISOString().slice(0, 10) !== asOf
  )
    throw new Error("Invalid as-of business date");
}

/** Last UTC millisecond of an NZ business day, using runtime DST rules. */
export function nzBusinessDayEndUtc(asOf: string): Date {
  validDay(asOf);
  let inside = Date.parse(asOf + "T00:00:00Z");
  let after = Date.parse(addDays(asOf, 1) + "T00:00:00Z");
  if (!Number.isFinite(after))
    throw new Error("Unsupported business-day boundary");
  const localDay = (millis: number) =>
    nzBusinessDateAt(new Date(millis)).padStart(10, "0");
  // Auckland midnight lies between these UTC midnights. Searching by local
  // date handles the offset on each boundary, including DST transition days.
  while (after - inside > 1) {
    const middle = inside + Math.floor((after - inside) / 2);
    if (localDay(middle) <= asOf) inside = middle;
    else after = middle;
  }
  if (localDay(inside) !== asOf || localDay(after) <= asOf) {
    throw new Error("Unsupported business-day boundary");
  }
  return new Date(inside);
}

/**
 * Read-only synthetic source confidence and cash-allocation reconciliation.
 * Knowledge cutoff is injected; legacy ledger/bank tables have no observed-at
 * provenance, so their results are NEVER described as verified provider feeds.
 */
export async function clientSourceReconciliation(
  db: Db,
  clientId: string,
  asOf: string,
  knowledgeCutoff: Date,
  maxAgeMinutes = 1440,
) {
  validDay(asOf);
  if (
    !(knowledgeCutoff instanceof Date) ||
    !Number.isFinite(knowledgeCutoff.getTime())
  ) {
    throw new Error("A valid UTC cutoff is required");
  }
  if (!Number.isSafeInteger(maxAgeMinutes) || maxAgeMinutes <= 0) {
    throw new Error("Invalid source freshness threshold");
  }
  const [client] = await db
    .select({ id: t.clients.id, name: t.clients.name })
    .from(t.clients)
    .where(eq(t.clients.id, clientId))
    .limit(1);
  if (!client) return null;
  const [checkpoints, observations, banks, ledgers] = await Promise.all([
    db
      .select()
      .from(t.ingestionCheckpoints)
      .where(eq(t.ingestionCheckpoints.clientId, clientId)),
    db
      .select({
        id: t.ingestionEvents.id,
        sourceKind: t.ingestionEvents.sourceKind,
        connectionId: t.ingestionEvents.connectionId,
        eventId: t.ingestionEvents.eventId,
        entityId: t.ingestionEvents.entityId,
        effectiveDate: t.ingestionEvents.effectiveDate,
        observedAt: t.ingestionEvents.observedAt,
      })
      .from(t.ingestionEvents)
      .where(
        and(
          eq(t.ingestionEvents.clientId, clientId),
          lte(t.ingestionEvents.effectiveDate, asOf),
          lte(t.ingestionEvents.observedAt, knowledgeCutoff),
        ),
      ),
    db
      .select()
      .from(t.bankTransactions)
      .where(
        and(
          eq(t.bankTransactions.clientId, clientId),
          lte(t.bankTransactions.date, asOf),
        ),
      )
      .orderBy(asc(t.bankTransactions.date), asc(t.bankTransactions.id)),
    db
      .select()
      .from(t.ledgerEntries)
      .where(
        and(
          eq(t.ledgerEntries.clientId, clientId),
          lte(t.ledgerEntries.recordedDate, asOf),
          lte(t.ledgerEntries.issueDate, asOf),
        ),
      ),
  ]);
  const latest = new Map<
    string,
    {
      kind: SourceKind;
      id: string;
      connectionId: string;
      health: SourceHealth;
      lastSuccess: string | null;
      lastFailure: string | null;
      acceptedEvents: number;
    }
  >();
  for (const kind of ["ACCOUNTING", "BANK"] as const) {
    const sources = checkpoints.filter((c) => c.sourceKind === kind);
    if (sources.length === 0) {
      latest.set(kind + ":none", {
        kind,
        id: kind + ":none",
        connectionId: "not-connected",
        health: "UNKNOWN",
        lastSuccess: null,
        lastFailure: null,
        acceptedEvents: 0,
      });
    }
    for (const item of sources) {
      const success =
        item.lastSuccessAt && item.lastSuccessAt <= knowledgeCutoff
          ? item.lastSuccessAt
          : null;
      const failure =
        item.lastFailureAt && item.lastFailureAt <= knowledgeCutoff
          ? item.lastFailureAt
          : null;
      const id = kind + ":" + item.connectionId;
      latest.set(id, {
        kind,
        id,
        connectionId: item.connectionId,
        health: sourceHealth(
          knowledgeCutoff.toISOString(),
          success?.toISOString() ?? null,
          failure?.toISOString() ?? null,
          maxAgeMinutes,
        ),
        lastSuccess: success?.toISOString() ?? null,
        lastFailure: failure?.toISOString() ?? null,
        acceptedEvents: observations.filter(
          (row) =>
            row.sourceKind === kind && row.connectionId === item.connectionId,
        ).length,
      });
    }
  }
  const ledgerById = new Map(ledgers.map((row) => [row.id, row]));
  const ledgerIds = [...ledgerById.keys()];
  const bankIds = banks.map((row) => row.id);
  const [allocations, creditNotes] = await Promise.all([
    bankIds.length
      ? db
          .select()
          .from(t.receiptAllocations)
          .where(inArray(t.receiptAllocations.bankTransactionId, bankIds))
      : [],
    ledgerIds.length
      ? db
          .select()
          .from(t.creditNotes)
          .where(
            and(
              inArray(t.creditNotes.ledgerEntryId, ledgerIds),
              lte(t.creditNotes.date, asOf),
            ),
          )
      : [],
  ]);
  const allocationLedgerIds = [
    ...new Set(allocations.map((row) => row.ledgerEntryId)),
  ];
  // Read ownership only for references outside the visible snapshot. These
  // may be same-client future records or invalid cross-client allocations;
  // never expose another client's source fields in the returned report.
  const unseenLedgerIds = allocationLedgerIds.filter(
    (id) => !ledgerById.has(id),
  );
  const unseenOwners = unseenLedgerIds.length
    ? await db
        .select({ id: t.ledgerEntries.id, clientId: t.ledgerEntries.clientId })
        .from(t.ledgerEntries)
        .where(inArray(t.ledgerEntries.id, unseenLedgerIds))
    : [];
  const ownerByLedgerId = new Map([
    ...ledgers.map((row) => [row.id, row.clientId] as const),
    ...unseenOwners.map((row) => [row.id, row.clientId] as const),
  ]);
  const rows = banks.map((bank) => {
    checked(bank.amountCents, "Bank amount");
    const bankAllocations = allocations.filter(
      (row) => row.bankTransactionId === bank.id,
    );
    for (const row of bankAllocations)
      checked(row.amountCents, "Receipt allocation");
    if (sum(bankAllocations.map((row) => row.amountCents)) > bank.amountCents) {
      throw new Error("Bank allocation exceeds available cash");
    }
    if (
      bankAllocations.some(
        (row) => ownerByLedgerId.get(row.ledgerEntryId) !== clientId,
      )
    ) {
      throw new Error(
        "Receipt allocation source is missing or outside this client",
      );
    }
    const allocated = bankAllocations.filter((row) =>
      ledgerById.has(row.ledgerEntryId),
    );
    const allocatedCents = sum(allocated.map((row) => row.amountCents));
    const unmatchedCents = bank.amountCents - allocatedCents;
    return {
      id: bank.id,
      date: bank.date,
      amountCents: bank.amountCents,
      allocatedCents,
      unmatchedCents,
      allocations: allocated
        .map((row) => ({
          ledgerId: row.ledgerEntryId,
          allocatedCents: row.amountCents,
        }))
        .sort((a, b) => a.ledgerId.localeCompare(b.ledgerId)),
      state:
        allocatedCents === 0
          ? ("UNMATCHED" as const)
          : unmatchedCents === 0
            ? ("MATCHED" as const)
            : ("PARTIAL" as const),
    };
  });
  for (const note of creditNotes) checked(note.amountCents, "Credit note");
  const bankTotalCents = sum(rows.map((row) => row.amountCents));
  const allocatedCents = sum(rows.map((row) => row.allocatedCents));
  const unmatchedCents = sum(rows.map((row) => row.unmatchedCents));
  if (bankTotalCents !== allocatedCents + unmatchedCents) {
    throw new Error("Cash allocation reconciliation failed");
  }
  return {
    client,
    asOf,
    knowledgeCutoff: knowledgeCutoff.toISOString(),
    thresholdMinutes: maxAgeMinutes,
    sourceHealth: [...latest.values()].sort((a, b) => a.id.localeCompare(b.id)),
    acceptedObservationIds: observations.map((row) => row.id).sort(),
    bankTransactions: rows,
    matchedCount: rows.filter((r) => r.state === "MATCHED").length,
    partialCount: rows.filter((r) => r.state === "PARTIAL").length,
    unmatchedCount: rows.filter((r) => r.state === "UNMATCHED").length,
    bankTotalCents,
    allocatedCents,
    unmatchedCents,
    creditNoteCents: sum(creditNotes.map((note) => note.amountCents)),
    creditNoteIds: creditNotes.map((note) => note.id).sort(),
    verifiedProviderSource: false as const,
  };
}
