import { PGlite } from "@electric-sql/pglite";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import ws from "ws";

import * as schema from "./schema";

export type Db = ReturnType<typeof drizzlePglite<typeof schema>>;

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "lib/db/migrations");

/**
 * In-memory PGlite database with all migrations applied. Used by tests, the
 * evaluation runner and the seed's holdout pass.
 */
export async function createMemoryDb(): Promise<Db> {
  const db = drizzlePglite({ client: new PGlite(), schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

let cached: Promise<Db> | undefined;
let closeCached: (() => Promise<void>) | undefined;

/** Closes the application database so scripts can exit cleanly. */
export async function closeDb(): Promise<void> {
  await closeCached?.();
  cached = undefined;
  closeCached = undefined;
}

/**
 * Application database. Neon (Pool over WebSocket, so interactive
 * transactions work) when DATABASE_URL is set; otherwise a PGlite database
 * persisted in .pglite/ for local development.
 */
export function getDb(): Promise<Db> {
  cached ??= open();
  return cached;
}

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    neonConfig.webSocketConstructor = ws;
    // Both drivers expose the same Drizzle PgDatabase query API.
    const pool = new Pool({ connectionString: url });
    closeCached = () => pool.end();
    return drizzleNeon({ client: pool, schema }) as unknown as Db;
  }
  const client = new PGlite(path.join(process.cwd(), ".pglite"), {
    // Local development only: flush asynchronously; seeding is many small writes.
    relaxedDurability: true,
  });
  closeCached = () => client.close();
  const db = drizzlePglite({ client, schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}
