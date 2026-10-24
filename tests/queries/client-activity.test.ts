import { describe, expect, it } from "vitest";

import { createMemoryDb } from "@/lib/db/client";
import { DEMO_TODAY } from "@/lib/demo";
import {
  getClientActivity,
  nzDateOfInstant,
  paginateClientActivity,
  type ClientActivity,
} from "@/lib/queries/client-activity";
import { DEV_PARAMS, generate } from "@/lib/seed/generate";
import { writeDataset } from "@/lib/seed/write";

const sample = (id: string, day: string): ClientActivity => ({
  id,
  kind: "BATCH",
  businessDate: day,
  occurredAt: null,
  title: "Submitted",
  detail: "Synthetic",
  sourceId: id,
  href: "/batches/" + id,
});

describe("client-scoped synthetic activity history", () => {
  it("orders deterministically, paginates without duplication and validates limits", () => {
    const events = [sample("b", "2026-01-02"), sample("a", "2026-01-02"),
      sample("x", "2026-01-03")];
    expect(paginateClientActivity(events, 1, 2).items.map((e) => e.id)).toEqual(["x", "a"]);
    expect(paginateClientActivity(events, 2, 2).items.map((e) => e.id)).toEqual(["b"]);
    expect(events[0]?.id).toBe("b");
    for (const page of [0, -1, 0.1, Number.NaN, Infinity]) {
      expect(() => paginateClientActivity(events, page, 2)).toThrow(/pagination/);
    }
    expect(() => paginateClientActivity(events, 1, 51)).toThrow(/pagination/);
  });

  it.each([
    ["2026-10-24T10:59:59.000Z", "2026-10-24"],
    ["2026-10-24T11:00:00.000Z", "2026-10-25"],
    ["2026-06-24T11:59:59.000Z", "2026-06-24"],
    ["2026-06-24T12:00:00.000Z", "2026-06-25"],
  ])("maps %s across NZ business-day boundaries", (instant, expected) => {
    expect(nzDateOfInstant(new Date(instant))).toBe(expected);
  });

  it("rejects malformed timestamps", () => {
    expect(() => nzDateOfInstant(new Date("invalid"))).toThrow(/timestamp/);
  });

  it("does not mix clients, include future events or invent missing balances", async () => {
    const db = await createMemoryDb();
    const dataset = generate(DEV_PARAMS);
    await writeDataset(db, dataset);
    const one = dataset.clients[0]!.id!;
    const two = dataset.clients[1]!.id!;
    const first = await getClientActivity(db, one, DEMO_TODAY, 1, 50);
    const second = await getClientActivity(db, two, DEMO_TODAY, 1, 50);
    expect(first?.clientId).toBe(one);
    expect(second?.clientId).toBe(two);
    expect(first?.total).toBeGreaterThan(0);
    expect(first?.items.every((e) => e.businessDate <= DEMO_TODAY)).toBe(true);
    expect(second?.items.every((e) => e.businessDate <= DEMO_TODAY)).toBe(true);
    const ownBatchIds = new Set(dataset.batches.filter((b) => b.clientId === one).map((b) => b.id));
    expect(first?.items.filter((e) => e.kind === "BATCH").every((e) =>
      ownBatchIds.has(e.sourceId))).toBe(true);
    expect(await getClientActivity(db, "not-a-real-client", DEMO_TODAY)).toBeNull();
    await expect(getClientActivity(db, one, "2026-02-30")).rejects.toThrow();
  }, 90_000);
});
