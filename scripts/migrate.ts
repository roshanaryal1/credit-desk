import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import ws from "ws";

import { MIGRATIONS_FOLDER } from "@/lib/db/client";

// Applies migrations to the database in DATABASE_URL (Neon). Local PGlite
// migrates itself on open, so this is only needed for preview and production.

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error(
      "DATABASE_URL is not set; local PGlite migrates automatically.",
    );
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
    console.log("Migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
