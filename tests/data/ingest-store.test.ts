import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createMemoryDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import {
  recordSourceBatch, recordSourceFailure, getSourceCheckpoint, sourceSnapshot,
} from "@/lib/data/ingest-store";
import type { SourceObservation } from "@/lib/data/observations";

const connection = { sourceKind: "ACCOUNTING" as const, connectionId: "sandbox",
  clientId: "client-1" };
const evt: SourceObservation<{ amount: number }> = {
  ...connection,
  eventId:"version-1",entityId:"invoice-1",effectiveDate:"2026-10-01",
  observedAt:"2026-10-02T08:00:00Z",payload:{amount:100},
};
const at = (v:string) => new Date(v);

async function dbWithClient() {
  const db=await createMemoryDb();
  await db.insert(t.clients).values({
    id:"client-1",name:"Synthetic lender",industry:"services",
    facilityLimitCents:500000, paymentTermsDays:30,advanceRateBps:8000,
  });
  await db.insert(t.clients).values({
    id:"client-2",name:"Another synthetic lender",industry:"retail",
    facilityLimitCents:900000, paymentTermsDays:30,advanceRateBps:7000,
  });
  return db;
}
describe("durable ingestion journal", () => {
  it("is idempotent across imports and keeps the checkpoint", async () => {
    const db=await dbWithClient();
    expect(await recordSourceBatch(db,connection,[evt],at("2026-10-03T00:00:00Z"),"p1"))
      .toEqual({inserted:1,duplicates:0});
    expect(await recordSourceBatch(db,connection,[evt,evt],at("2026-10-03T01:00:00Z"),"p2"))
      .toEqual({inserted:0,duplicates:2});
    const rows=await db.select().from(t.ingestionEvents);
    expect(rows).toHaveLength(1);
    const point=await getSourceCheckpoint(db,connection);
    expect(point?.cursor).toBe("p2");
    expect(point?.lastSuccessAt?.toISOString()).toBe("2026-10-03T01:00:00.000Z");
  });

  it("rejects conflicting replay without replacing the winning fact", async () => {
    const db=await dbWithClient();
    await recordSourceBatch(db,connection,[evt],at("2026-10-03T00:00:00Z"),null);
    await expect(recordSourceBatch(db,connection,[
      {...evt,payload:{amount:90}},
    ],at("2026-10-03T01:00:00Z"),null)).rejects.toThrow(/conflict/i);
    const latest=await sourceSnapshot(db,connection,"2026-10-10","2026-10-10T23:59:59Z");
    expect(latest[0]?.payload).toEqual({amount:100});
  });

  it("respects both effective and knowledge cutoff and isolates the client", async () => {
    const db=await dbWithClient();
    await recordSourceBatch(db,connection,[evt],at("2026-10-03T00:00:00Z"),null);
    const corrected={...evt,eventId:"version-2",
      observedAt:"2026-10-15T08:00:00Z",payload:{amount:75}};
    await recordSourceBatch(db,connection,[corrected],at("2026-10-16T00:00:00Z"),null);
    const early=await sourceSnapshot(db,connection,"2026-10-10","2026-10-10T23:59:59Z");
    expect(early.map(x=>x.payload)).toEqual([{amount:100}]);
    const late=await sourceSnapshot(db,connection,"2026-10-10","2026-10-20T00:00:00Z");
    expect(late.map(x=>x.payload)).toEqual([{amount:75}]);
    expect(await sourceSnapshot(db,{...connection,clientId:"client-2"},
      "2026-10-20","2026-10-20T00:00:00Z")).toHaveLength(0);
  });

  it("tracks sync failures without erasing last successful position", async () => {
    const db=await dbWithClient();
    await recordSourceBatch(db,connection,[],at("2026-10-03T00:00:00Z"),"initial");
    await recordSourceFailure(db,connection,at("2026-10-04T00:00:00Z"));
    const point=await getSourceCheckpoint(db,connection);
    expect(point?.cursor).toBe("initial");
    expect(point?.lastSuccessAt).not.toBeNull();
    expect(point?.lastFailureAt?.toISOString()).toBe("2026-10-04T00:00:00.000Z");
  });

  it("rolls back the whole batch when one event conflicts", async () => {
    const db=await dbWithClient();
    await recordSourceBatch(db,connection,[evt],at("2026-10-03T00:00:00Z"),"old");
    await expect(recordSourceBatch(db,connection,[
      {...evt,eventId:"another",observedAt:"2026-10-02T07:00:00Z"},
      {...evt,payload:{amount:999}},
    ],at("2026-10-03T01:00:00Z"),"new")).rejects.toThrow(/conflict/i);
    expect(await db.select().from(t.ingestionEvents)).toHaveLength(1);
    expect((await getSourceCheckpoint(db,connection))?.cursor).toBe("old");
  });

  it("makes accepted event rows append-only at the database layer", async () => {
    const db=await dbWithClient();
    await recordSourceBatch(db,connection,[evt],at("2026-10-03T00:00:00Z"),null);
    await expect(db.delete(t.ingestionEvents)
      .where(eq(t.ingestionEvents.eventId,"version-1"))).rejects.toThrow(/Failed query|append-only/);
    expect(await db.select().from(t.ingestionEvents)).toHaveLength(1);
  });
});
