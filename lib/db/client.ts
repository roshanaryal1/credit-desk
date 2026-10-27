import { PGlite } from "@electric-sql/pglite";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import ws from "ws";

import * as schema from "./schema";
import { chooseDatabaseBackend } from "./backend";

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

// Shared on globalThis: proxy.ts and the app are bundled separately but run
// in one Node process, and a local PGlite directory must be opened only once.
const shared = globalThis as typeof globalThis & {
  __creditDeskDb?: { db?: Promise<Db>; close?: () => Promise<void> };
};
const holder = (shared.__creditDeskDb ??= {});

/** Closes the application database so scripts can exit cleanly. */
export async function closeDb(): Promise<void> {
  await holder.close?.();
  holder.db = undefined;
  holder.close = undefined;
}

/**
 * Application database. Neon (Pool over WebSocket, so interactive
 * transactions work) when DATABASE_URL is set; otherwise a PGlite database
 * persisted in .pglite/ for local development.
 */
export function getDb(): Promise<Db> {
  holder.db ??= open();
  return holder.db;
}

async function open(): Promise<Db> {
  const selected = chooseDatabaseBackend(process.env);
  const url = process.env.DATABASE_URL;
  if (selected === "NEON" && url) {
    neonConfig.webSocketConstructor = ws;
    // Both drivers expose the same Drizzle PgDatabase query API.
    const pool = new Pool({ connectionString: url });
    holder.close = () => pool.end();
    return drizzleNeon({ client: pool, schema }) as unknown as Db;
  }
  const client = new PGlite(path.join(process.cwd(), ".pglite"), {
    // Local development only: flush asynchronously; seeding is many small writes.
    relaxedDurability: true,
  });
  holder.close = () => client.close();
  const db = drizzlePglite({ client, schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}
