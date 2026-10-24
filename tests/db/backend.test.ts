import { describe, expect, it } from "vitest";

import { chooseDatabaseBackend } from "@/lib/db/backend";

describe("production DB fail-closed boundary", () => {
  it("chooses Neon only when a nonempty DATABASE_URL is present", () => {
    expect(chooseDatabaseBackend({
      NODE_ENV: "production", DATABASE_URL: "postgres://fixture.invalid",
      VERCEL: "1",
    } as NodeJS.ProcessEnv)).toBe("NEON");
  });
  it("refuses persistent local PGlite on production or Vercel", () => {
    for (const env of [
      { NODE_ENV: "production" },
      { NODE_ENV: "production", VERCEL: "1" },
      { NODE_ENV: "production", DATABASE_URL: "   " },
      { NODE_ENV: "production", VERCEL: "1", CI: "true", CREDIT_DESK_CI_PGLITE: "1" },
    ]) expect(() => chooseDatabaseBackend(env as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL required/);
  });
  it("permits explicit CI-only disposable browser demo", () => {
    expect(chooseDatabaseBackend({
      NODE_ENV: "production", CI: "true", CREDIT_DESK_CI_PGLITE: "1",
    } as NodeJS.ProcessEnv)).toBe("PGLITE");
    expect(() => chooseDatabaseBackend({
      NODE_ENV: "production", CREDIT_DESK_CI_PGLITE: "1",
    } as NodeJS.ProcessEnv)).toThrow();
  });
  it("retains local development and test behavior", () => {
    for (const env of [
      { NODE_ENV: "development" }, { NODE_ENV: "test" }, {},
    ]) expect(chooseDatabaseBackend(env as NodeJS.ProcessEnv)).toBe("PGLITE");
  });
});
