import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMemoryDb, type Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { provisionUser } from "@/lib/identity/admin";
import { bindUser, createSession, revokeSessions } from "@/lib/identity/store";
import { SESSION_COOKIE } from "@/lib/identity/tokens";
import { proxy } from "@/proxy";

const saved = { ...process.env };
const holder = () =>
  (globalThis as unknown as { __creditDeskDb: { db?: Promise<Db> } })
    .__creditDeskDb;
const TENANT = "bank-test";
let db: Db;
const tokens: Record<string, string> = {};

async function user(
  key: string,
  roles: ("ANALYST" | "CHECKER" | "AUDITOR" | "ADMIN")[],
  clientIds: string[],
  mfa = true,
) {
  const admin = { userId: "usr_seedadmin", tenantId: TENANT };
  const r = await provisionUser(db, admin, {
    email: `${key}@bank.test`,
    displayName: key,
    roles,
    clientIds,
  });
  if (!r.ok) throw new Error(r.message);
  await bindUser(db, TENANT, {
    issuer: "https://idp.bank.test",
    subject: key,
    email: `${key}@bank.test`,
    emailVerified: true,
    mfa,
  });
  const s = await createSession(db, r.userId, mfa, new Date());
  tokens[key] = s.token;
  return s;
}

beforeAll(async () => {
  Object.assign(process.env, {
    AUTH_MODE: "oidc",
    OIDC_ISSUER: "https://idp.bank.test",
    OIDC_CLIENT_ID: "credit-desk",
    OIDC_CLIENT_SECRET: "secret",
    OIDC_REDIRECT_URI: "https://app.bank.test/auth/callback",
    CREDIT_DESK_TENANT_ID: TENANT,
    SESSION_SECRET: "s".repeat(48),
  });
  db = await createMemoryDb();
  // Mutate the holder lib/db/client captured at import; do not replace it.
  holder().db = Promise.resolve(db);
  await db.insert(t.clients).values([
    {
      id: "cli_a",
      name: "A",
      industry: "x",
      facilityLimitCents: 1,
      paymentTermsDays: 30,
    },
    {
      id: "cli_b",
      name: "B",
      industry: "x",
      facilityLimitCents: 1,
      paymentTermsDays: 30,
    },
  ]);
  await db.insert(t.batches).values([
    {
      id: "bat_a",
      clientId: "cli_a",
      submittedDate: "2026-10-01",
      status: "PENDING",
    },
    {
      id: "bat_b",
      clientId: "cli_b",
      submittedDate: "2026-10-01",
      status: "PENDING",
    },
  ]);
  await user("analyst", ["ANALYST"], ["cli_a"]);
  await user("checker", ["CHECKER"], ["cli_a", "cli_b"]);
  await user("admin", ["ADMIN"], []);
}, 60_000);
afterAll(() => {
  process.env = saved;
  holder().db = undefined;
});

function req(path: string, token?: string, action = false) {
  const headers = new Headers();
  if (token) headers.set("cookie", `${SESSION_COOKIE}=${token}`);
  if (action) headers.set("next-action", "7f00");
  return proxy(
    new NextRequest(`http://localhost${path}`, {
      method: action ? "POST" : "GET",
      headers,
    }),
  );
}
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("verified identity proxy (#109)", () => {
  it("sends unauthenticated requests to sign-in, action-aware", async () => {
    const page = await req("/queue");
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login?next=%2Fqueue");
    const action = await req("/queue", undefined, true);
    expect(action.headers.get("x-action-redirect")).toBe(
      "/login?next=%2Fqueue;push",
    );
  });
  it("leaves the sign-in endpoints open", async () => {
    expect(passes(await req("/auth/login"))).toBe(true);
    expect(passes(await req("/auth/callback?code=x"))).toBe(true);
  });
  it("applies role routes", async () => {
    expect(passes(await req("/queue", tokens.checker))).toBe(true);
    expect((await req("/admin/users", tokens.analyst)).status).toBe(307);
    expect(passes(await req("/admin/users", tokens.admin))).toBe(true);
    expect(
      (await req("/queue", tokens.admin)).headers.get("location"),
    ).toContain("/admin/users");
    expect((await req("/demo/client", tokens.checker)).status).toBe(307);
  });
  it("enforces client grants on client, batch and memo paths", async () => {
    expect(passes(await req("/clients/cli_a", tokens.analyst))).toBe(true);
    expect((await req("/clients/cli_b", tokens.analyst)).status).toBe(404);
    expect(
      (await req("/credit-memos/cli_b/export", tokens.analyst)).status,
    ).toBe(404);
    expect(
      passes(await req("/batches/bat_a?invoice=inv_x", tokens.analyst)),
    ).toBe(true);
    expect((await req("/batches/bat_b", tokens.analyst)).status).toBe(404);
    expect((await req("/batches/bat_missing", tokens.analyst)).status).toBe(
      404,
    );
    expect(passes(await req("/batches/bat_b", tokens.checker))).toBe(true);
    expect(
      (await req("/trust/replay/dec_missing", tokens.checker)).status,
    ).toBe(404);
  });
  it("stops a revoked session on the very next request", async () => {
    const s = await user("revokee", ["ANALYST"], ["cli_a"]);
    expect(passes(await req("/clients/cli_a", s.token))).toBe(true);
    await revokeSessions(
      db,
      { sessionId: s.sessionId },
      "ADMIN_REVOKE",
      "user:test",
      new Date(),
    );
    const after = await req("/clients/cli_a", s.token);
    expect(after.status).toBe(307);
    expect(after.headers.get("location")).toContain("/login");
  });
  it("keeps partially granted users off portfolio-wide pages and exports", async () => {
    for (const path of [
      "/",
      "/queue",
      "/clients",
      "/watch",
      "/portfolio/export?client=cli_b",
    ]) {
      const res = await req(path, tokens.analyst);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/clients/cli_a");
    }
    // Audit history needs AUDIT_READ: the analyst is sent away from it.
    const audit = await req("/audit", tokens.analyst);
    expect(audit.status).toBe(307);
    expect(audit.headers.get("location")).not.toContain("/audit");
    const action = await req("/queue", tokens.analyst, true);
    expect(action.headers.get("x-action-redirect")).toBe("/clients/cli_a;push");
    expect(passes(await req("/queue", tokens.checker))).toBe(true);
  });
  it("denies ungranted server actions with an action-aware redirect", async () => {
    const page = await req("/batches/bat_b", tokens.analyst);
    expect(page.status).toBe(404);
    const action = await req("/batches/bat_b", tokens.analyst, true);
    expect(action.status).toBe(200);
    expect(action.headers.get("x-action-redirect")).toBe("/;push");
  });
  it("treats malformed escapes in scoped ids as not found", async () => {
    expect((await req("/clients/%E0%A4%A", tokens.checker)).status).toBe(404);
    expect((await req("/batches/%E0%A4%A", tokens.checker)).status).toBe(404);
    expect((await req("/trust/replay/%E0%A4%A", tokens.checker)).status).toBe(
      404,
    );
  });
  it("rejects forged or demo cookies in identity mode", async () => {
    expect((await req("/queue", "forged-token")).status).toBe(307);
    const demo = new NextRequest("http://localhost/queue", {
      headers: { cookie: "cd_auth=anything" },
    });
    expect((await proxy(demo)).status).toBe(307);
  });
});
