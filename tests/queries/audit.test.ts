import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createMemoryDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { olderThan } from "@/lib/queries/audit";

describe("audit pagination boundary", () => {
  it("does not skip events that share a millisecond", async () => {
    const db = await createMemoryDb();
    for (const [id, micros] of [
      ["aud_a", "401"],
      ["aud_b", "402"],
      ["aud_c", "403"],
    ] as const) {
      await db.execute(
        sql`insert into audit_events (id, actor, action, entity_type, entity_id, payload_json, created_at) values (${id}, 'x', 'TEST', 'x', 'x', '{}', ${`2026-10-20 10:00:00.123${micros}+00`}::timestamptz)`,
      );
    }
    const older = await db
      .select({ id: t.auditEvents.id })
      .from(t.auditEvents)
      .where(olderThan("aud_c"));
    expect(older.map((r) => r.id).sort()).toEqual(["aud_a", "aud_b"]);
  });
});
