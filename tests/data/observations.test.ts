import { describe, expect, it } from "vitest";

import {
  knownSnapshotAsOf,
  reconcileObservations,
  sourceHealth,
  type SourceObservation,
} from "@/lib/data/observations";

const invoice: SourceObservation<{ amountCents: number }> = {
  sourceKind: "ACCOUNTING",
  connectionId: "synthetic-xero-one",
  clientId: "client-a",
  eventId: "entry-v1",
  entityId: "inv-10",
  effectiveDate: "2026-10-01",
  observedAt: "2026-10-02T08:00:00Z",
  payload: { amountCents: 10_000 },
};

describe("source provenance and reconciliation", () => {
  it("replays duplicate imports idempotently regardless of JSON key order", () => {
    const start = reconcileObservations([], [invoice]);
    const replay = reconcileObservations(start.observations, [
      { ...invoice, payload: { amountCents: 10_000 } },
    ]);
    expect(start.accepted).toBe(1);
    expect(replay.accepted).toBe(0);
    expect(replay.duplicates).toBe(1);
    expect(replay.observations).toEqual(start.observations);
  });

  it("fails closed when the same provider event ID has conflicting content", () => {
    expect(() =>
      reconcileObservations([invoice], [
        { ...invoice, payload: { amountCents: 9_000 } },
      ]),
    ).toThrow(/conflict/);
  });

  it("preserves effective date versus date first known to the analyst", () => {
    const corrected = {
      ...invoice,
      eventId: "entry-v2",
      observedAt: "2026-10-14T09:00:00Z",
      payload: { amountCents: 8_000 },
    };
    const events = reconcileObservations([], [corrected, invoice]).observations;
    const early = knownSnapshotAsOf(
      events,
      "2026-10-10",
      "2026-10-10T23:59:00Z",
      "client-a",
    );
    expect(early).toHaveLength(1);
    expect(early[0]?.payload.amountCents).toBe(10_000);
    const late = knownSnapshotAsOf(
      events,
      "2026-10-10",
      "2026-10-15T00:00:00Z",
      "client-a",
    );
    expect(late[0]?.payload.amountCents).toBe(8_000);
  });

  it("does not leak another client's data under shared provider IDs", () => {
    const other = {
      ...invoice,
      clientId: "client-b",
      payload: { amountCents: 99_999 },
    };
    const all = reconcileObservations([], [invoice, other]).observations;
    expect(
      knownSnapshotAsOf(
        all,
        "2026-10-24",
        "2026-10-24T12:00:00Z",
        "client-a",
      ),
    ).toEqual([invoice]);
  });

  it("rejects malformed dates, missing metadata and contradictory persisted events", () => {
    expect(() =>
      reconcileObservations([], [
        { ...invoice, effectiveDate: "2026-09-31" },
      ]),
    ).toThrow(/effective/);
    expect(() =>
      reconcileObservations([], [{ ...invoice, observedAt: "10/02/26" }]),
    ).toThrow(/UTC/);
    expect(() =>
      reconcileObservations([], [{ ...invoice, clientId: " " }]),
    ).toThrow(/identifiers/);
    expect(() =>
      reconcileObservations(
        [invoice, { ...invoice, payload: { amountCents: 1 } }],
        [],
      ),
    ).toThrow(/persisted/);
  });

  it("records unknown, stale, healthy and failed source states explicitly", () => {
    const now = "2026-10-24T08:00:00Z";
    expect(sourceHealth(now, null, null, 60)).toBe("UNKNOWN");
    expect(sourceHealth(now, "2026-10-24T07:30:00Z", null, 60)).toBe(
      "FRESH",
    );
    expect(sourceHealth(now, "2026-10-24T06:00:00Z", null, 60)).toBe(
      "STALE",
    );
    expect(
      sourceHealth(
        now,
        "2026-10-24T07:30:00Z",
        "2026-10-24T07:45:00Z",
        60,
      ),
    ).toBe("ERROR");
    expect(() =>
      sourceHealth(now, "2026-10-24T09:00:00Z", null, 60),
    ).toThrow(/future/);
  });
});
