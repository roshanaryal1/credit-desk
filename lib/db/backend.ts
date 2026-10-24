/**
 * Choose a database backend deliberately. A serverless production deployment
 * must never silently fall back to a local, ephemeral PGlite data directory.
 * Only the isolated CI browser-smoke harness can opt into production-mode
 * local PGlite, and never when running inside Vercel.
 */
export function chooseDatabaseBackend(
  env: NodeJS.ProcessEnv,
): "NEON" | "PGLITE" {
  if (env.DATABASE_URL?.trim()) return "NEON";
  const isolatedSmoke =
    env.CREDIT_DESK_CI_PGLITE === "1" && env.CI === "true" && !env.VERCEL;
  if (env.NODE_ENV === "production" && !isolatedSmoke) {
    throw new Error(
      "Production database unavailable: DATABASE_URL required. Local PGlite is disabled.",
    );
  }
  return "PGLITE";
}
