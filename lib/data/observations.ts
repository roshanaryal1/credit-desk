/**
 * Provider-neutral, deterministic ingestion primitives. Synthetic fixtures may
 * use this immediately; real accounting/banking connections need separate
 * authorization, secure checkpoints and durable storage (#106).
 *
 * Effective date and first-observed instant are intentionally different:
 * a record discovered today must not appear in an analyst's historic
 * knowledge-cutoff view even when it describes last month's invoice.
 */

export type SourceKind = "ACCOUNTING" | "BANK";

export interface SourceObservation<T> {
  sourceKind: SourceKind;
  connectionId: string;
  clientId: string;
  eventId: string;
  entityId: string;
  effectiveDate: string;
  observedAt: string;
  payload: T;
}

export interface Reconciliation<T> {
  observations: SourceObservation<T>[];
  accepted: number;
  duplicates: number;
}

export type SourceHealth = "UNKNOWN" | "FRESH" | "STALE" | "ERROR";

function businessDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

function instant(value: string): number {
  // Explicit UTC 'Z' prevents host-timezone-dependent ordering.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new Error("Observed instant must be ISO 8601 UTC with Z");
  }
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error("Invalid observed instant");
  return millis;
}

function check<T>(r: SourceObservation<T>): void {
  if (!["ACCOUNTING", "BANK"].includes(r.sourceKind)) {
    throw new Error("Unsupported source kind");
  }
  if (![r.connectionId, r.clientId, r.eventId, r.entityId].every(
    (value) => typeof value === "string" && value.trim().length > 0,
  )) {
    throw new Error("Source, client, event and entity identifiers are required");
  }
  if (!businessDate(r.effectiveDate)) {
    throw new Error("Invalid effective business date");
  }
  instant(r.observedAt);
  if (r.payload === undefined) throw new Error("Source payload required");
}

/** Stable JSON used for conflict checking, not as a cryptographic checksum. */
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const result = JSON.stringify(value);
    if (result === undefined) throw new Error("Unserializable source payload");
    return result;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stable(item)).join(",")}]`;
  }
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
}

function key(r: SourceObservation<unknown>): string {
  return JSON.stringify([
    r.sourceKind,
    r.connectionId,
    r.clientId,
    r.eventId,
  ]);
}

function order<T>(a: SourceObservation<T>, b: SourceObservation<T>): number {
  return (
    a.observedAt.localeCompare(b.observedAt) ||
    a.sourceKind.localeCompare(b.sourceKind) ||
    a.connectionId.localeCompare(b.connectionId) ||
    a.clientId.localeCompare(b.clientId) ||
    a.eventId.localeCompare(b.eventId)
  );
}

/**
 * Event-level idempotency: the same provider event is safely replayed, but
 * reusing its identity for different content fails closed.
 */
export function reconcileObservations<T>(
  existing: SourceObservation<T>[],
  incoming: SourceObservation<T>[],
): Reconciliation<T> {
  const seen = new Map<string, SourceObservation<T>>();
  let accepted = 0;
  let duplicates = 0;
  for (const observation of existing) {
    check(observation);
    const identity = key(observation);
    const prior = seen.get(identity);
    if (prior && stable(prior) !== stable(observation)) {
      throw new Error(`Conflicting persisted source event ${observation.eventId}`);
    }
    seen.set(identity, observation);
  }
  for (const observation of incoming) {
    check(observation);
    const identity = key(observation);
    const prior = seen.get(identity);
    if (prior) {
      if (stable(prior) !== stable(observation)) {
        throw new Error(`Source event conflict ${observation.eventId}`);
      }
      duplicates++;
      continue;
    }
    seen.set(identity, observation);
    accepted++;
  }
  return {
    observations: [...seen.values()].sort(order),
    accepted,
    duplicates,
  };
}

/**
 * What had been learned about each entity at the specified business date AND
 * at the observer's UTC cutoff. Never infer unseen future adjustments.
 */
export function knownSnapshotAsOf<T>(
  observations: SourceObservation<T>[],
  businessAsOf: string,
  knowledgeCutoff: string,
  clientId: string,
): SourceObservation<T>[] {
  if (!businessDate(businessAsOf)) throw new Error("Invalid as-of business date");
  const cutoff = instant(knowledgeCutoff);
  const latest = new Map<string, SourceObservation<T>>();
  for (const observation of [...observations].sort(order)) {
    check(observation);
    if (
      observation.clientId !== clientId ||
      observation.effectiveDate > businessAsOf ||
      instant(observation.observedAt) > cutoff
    ) {
      continue;
    }
    const scopedKey = JSON.stringify([
      observation.sourceKind,
      observation.connectionId,
      observation.clientId,
      observation.entityId,
    ]);
    latest.set(scopedKey, observation);
  }
  return [...latest.values()].sort(order);
}

export function sourceHealth(
  nowUtc: string,
  lastSuccessUtc: string | null,
  lastFailureUtc: string | null,
  maxAgeMinutes: number,
): SourceHealth {
  const now = instant(nowUtc);
  if (!Number.isSafeInteger(maxAgeMinutes) || maxAgeMinutes < 1) {
    throw new Error("maxAgeMinutes must be a positive integer");
  }
  if (lastSuccessUtc === null && lastFailureUtc === null) return "UNKNOWN";
  const success = lastSuccessUtc === null ? null : instant(lastSuccessUtc);
  const failure = lastFailureUtc === null ? null : instant(lastFailureUtc);
  if ((success !== null && success > now) || (failure !== null && failure > now)) {
    throw new Error("Source health cannot include future events");
  }
  if (failure !== null && (success === null || failure > success)) return "ERROR";
  if (success === null || now - success > maxAgeMinutes * 60_000) return "STALE";
  return "FRESH";
}
