import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import { MIGRATIONS_FOLDER } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";

it("upgrades the v1 journal without losing records or append-only protection", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "credit-migration-"));
  const client = new PGlite();
  try {
    const journal = JSON.parse(
      await readFile(
        path.join(MIGRATIONS_FOLDER, "meta/_journal.json"),
        "utf8",
      ),
    );
    journal.entries = journal.entries.slice(0, 3);
    await mkdir(path.join(folder, "meta"));
    await writeFile(
      path.join(folder, "meta/_journal.json"),
      JSON.stringify(journal),
    );
    for (const entry of journal.entries)
      await cp(
        path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
        path.join(folder, `${entry.tag}.sql`),
      );
    const db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder: folder });
    await db.insert(schema.auditEvents).values({
      id: "before-upgrade",
      actor: "test",
      action: "TEST",
      entityType: "test",
      entityId: "synthetic",
      payload: {},
    });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    expect(await db.select().from(schema.auditEvents)).toHaveLength(1);
    expect(await db.select().from(schema.ingestionEvents)).toEqual([]);
    expect(await db.select().from(schema.ingestionSyncJobs)).toEqual([]);
    expect(await db.select().from(schema.creditCaseEvents)).toEqual([]);
    await expect(
      db
        .delete(schema.auditEvents)
        .where(eq(schema.auditEvents.id, "before-upgrade")),
    ).rejects.toThrow();
  } finally {
    await client.close();
    await rm(folder, { recursive: true, force: true });
  }
});
