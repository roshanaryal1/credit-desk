import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDb, type Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import {
  provisionUser,
  setUserActive,
  updateAccess,
} from "@/lib/identity/admin";
import {
  bindUser,
  createSession,
  resolveSession,
  revokeSessions,
} from "@/lib/identity/store";

const TENANT = "bank-test";
const ISSUER = "https://idp.bank.test";
const REALM = { tenantId: TENANT, issuer: `${ISSUER}/` };
let db: Db;
const admin = { userId: "usr_admin00000", tenantId: TENANT };
const now = new Date("2026-10-27T00:00:00Z");

beforeEach(async () => {
  db = await createMemoryDb();
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
  await db.insert(t.users).values({
    id: admin.userId,
    tenantId: TENANT,
    email: "admin@bank.test",
    displayName: "Admin",
  });
  await db.insert(t.userRoles).values({ userId: admin.userId, role: "ADMIN" });
}, 30_000);

const claims = (over: Partial<Parameters<typeof bindUser>[2]> = {}) => ({
  issuer: ISSUER,
  subject: "sub-1",
  email: "analyst@bank.test",
  emailVerified: true,
  mfa: true,
  ...over,
});

async function analyst(clientIds = ["cli_a"]) {
  const r = await provisionUser(db, admin, {
    email: "Analyst@Bank.test",
    displayName: "Ana Lyst",
    roles: ["ANALYST"],
    clientIds,
  });
  if (!r.ok) throw new Error(r.message);
  return r.userId;
}

describe("user binding (#109)", () => {
  it("binds a provisioned user once by verified email, then by subject", async () => {
    const id = await analyst();
    expect(await bindUser(db, TENANT, claims())).toEqual({
      ok: true,
      userId: id,
    });
    // Email changes at the IdP do not matter once the subject is bound.
    expect(
      await bindUser(db, TENANT, claims({ email: "renamed@bank.test" })),
    ).toEqual({ ok: true, userId: id });
  });
  it("never self-registers and ignores unverified email", async () => {
    expect(await bindUser(db, TENANT, claims())).toEqual({
      ok: false,
      reason: "NOT_PROVISIONED",
    });
    await analyst();
    expect(
      await bindUser(db, TENANT, claims({ emailVerified: false })),
    ).toEqual({ ok: false, reason: "NOT_PROVISIONED" });
  });
  it("refuses a second identity claiming an already bound account", async () => {
    await analyst();
    await bindUser(db, TENANT, claims());
    expect(await bindUser(db, TENANT, claims({ subject: "sub-2" }))).toEqual({
      ok: false,
      reason: "IDENTITY_CONFLICT",
    });
  });
  it("refuses disabled users and other tenants", async () => {
    const id = await analyst();
    await bindUser(db, TENANT, claims());
    expect(await bindUser(db, "other-tenant", claims())).toEqual({
      ok: false,
      reason: "IDENTITY_CONFLICT",
    });
    await setUserActive(db, admin, id, false, now);
    expect(await bindUser(db, TENANT, claims())).toEqual({
      ok: false,
      reason: "DISABLED",
    });
  });
});

describe("revocable sessions", () => {
  it("resolves a live session with roles and grants, then stops after revocation", async () => {
    const id = await analyst(["cli_b", "cli_a"]);
    await bindUser(db, TENANT, claims());
    const s = await createSession(db, id, true, now);
    const [stored] = await db
      .select()
      .from(t.authSessions)
      .where(eq(t.authSessions.id, s.sessionId));
    expect(stored!.tokenSha256).not.toContain(s.token);
    const live = await resolveSession(db, s.token, now, REALM);
    expect(live?.identity).toMatchObject({
      subject: id,
      tenantId: TENANT,
      issuer: ISSUER,
      roles: ["ANALYST"],
      clientGrants: ["cli_a", "cli_b"],
      mfaSatisfied: true,
    });
    expect(
      await revokeSessions(
        db,
        { sessionId: s.sessionId },
        "SIGN_OUT",
        `user:${id}`,
        now,
      ),
    ).toBe(1);
    expect(await resolveSession(db, s.token, now, REALM)).toBeNull();
    const audit = await db
      .select()
      .from(t.auditEvents)
      .where(eq(t.auditEvents.action, "SESSION_REVOKED"));
    expect(audit).toHaveLength(1);
  });
  it("expires sessions after their absolute lifetime", async () => {
    const id = await analyst();
    await bindUser(db, TENANT, claims());
    const s = await createSession(db, id, true, now);
    expect(
      await resolveSession(
        db,
        s.token,
        new Date(s.expiresAt.getTime() - 1),
        REALM,
      ),
    ).not.toBeNull();
    expect(await resolveSession(db, s.token, s.expiresAt, REALM)).toBeNull();
  });
  it("ignores unknown, oversized and missing tokens", async () => {
    expect(await resolveSession(db, undefined, now, REALM)).toBeNull();
    expect(await resolveSession(db, "nope", now, REALM)).toBeNull();
    expect(await resolveSession(db, "x".repeat(500), now, REALM)).toBeNull();
  });
  it("disabling a user revokes every live session immediately", async () => {
    const id = await analyst();
    await bindUser(db, TENANT, claims());
    const a = await createSession(db, id, true, now);
    const b = await createSession(db, id, true, now);
    await setUserActive(db, admin, id, false, now);
    expect(await resolveSession(db, a.token, now, REALM)).toBeNull();
    expect(await resolveSession(db, b.token, now, REALM)).toBeNull();
  });
});

describe("issuer comparison", () => {
  it("treats origin-only issuers with and without a slash as equal", async () => {
    const { sameIssuer } = await import("@/lib/identity/store");
    expect(sameIssuer("https://idp.test", "https://idp.test/")).toBe(true);
    expect(sameIssuer("https://idp.test/realm", "https://idp.test/realm")).toBe(
      true,
    );
    expect(
      sameIssuer("https://idp.test/realm", "https://idp.test/realm/"),
    ).toBe(false);
    expect(sameIssuer("https://idp.test", "https://other.test/")).toBe(false);
  });
});

describe("session issuance", () => {
  it("refuses to issue a session for a disabled user", async () => {
    const { UserNotActiveError } = await import("@/lib/identity/store");
    const id = await analyst();
    await bindUser(db, TENANT, claims());
    await setUserActive(db, admin, id, false, now);
    await expect(createSession(db, id, true, now)).rejects.toBeInstanceOf(
      UserNotActiveError,
    );
    const sessions = await db
      .select()
      .from(t.authSessions)
      .where(eq(t.authSessions.userId, id));
    expect(sessions).toHaveLength(0);
  });
});

describe("realm binding", () => {
  it("rejects a live session from another tenant or issuer", async () => {
    const id = await analyst();
    await bindUser(db, TENANT, claims());
    const s = await createSession(db, id, true, now);
    expect(await resolveSession(db, s.token, now, REALM)).not.toBeNull();
    expect(
      await resolveSession(db, s.token, now, { ...REALM, tenantId: "other" }),
    ).toBeNull();
    expect(
      await resolveSession(db, s.token, now, {
        ...REALM,
        issuer: "https://evil.test",
      }),
    ).toBeNull();
  });
  it("does not report success when a concurrent sign-in already bound the account", async () => {
    await analyst();
    await bindUser(db, TENANT, claims({ subject: "first" }));
    expect(await bindUser(db, TENANT, claims({ subject: "second" }))).toEqual({
      ok: false,
      reason: "IDENTITY_CONFLICT",
    });
  });
});

describe("administration guards and audit", () => {
  it("rejects unknown clients and duplicate emails", async () => {
    expect(
      await provisionUser(db, admin, {
        email: "x@bank.test",
        displayName: "X",
        roles: [],
        clientIds: ["cli_zzz"],
      }),
    ).toMatchObject({ ok: false });
    await analyst();
    expect(
      await provisionUser(db, admin, {
        email: "analyst@bank.test",
        displayName: "Dup",
        roles: [],
        clientIds: [],
      }),
    ).toMatchObject({ ok: false });
  });
  it("prevents administrators locking themselves out", async () => {
    expect(
      await updateAccess(db, admin, admin.userId, {
        roles: ["ANALYST"],
        clientIds: [],
      }),
    ).toMatchObject({ ok: false });
    expect(
      await setUserActive(db, admin, admin.userId, false, now),
    ).toMatchObject({ ok: false });
  });
  it("cannot touch users of another tenant", async () => {
    const id = await analyst();
    const other = { userId: "usr_other0000", tenantId: "other-tenant" };
    expect(
      await updateAccess(db, other, id, { roles: ["ADMIN"], clientIds: [] }),
    ).toEqual({ ok: false, message: "User not found." });
  });
  it("records before and after for access changes", async () => {
    const id = await analyst(["cli_a"]);
    await updateAccess(db, admin, id, {
      roles: ["CHECKER"],
      clientIds: ["cli_b"],
    });
    const [event] = await db
      .select()
      .from(t.auditEvents)
      .where(eq(t.auditEvents.action, "USER_ACCESS_CHANGED"));
    expect(event!.payload).toEqual({
      before: { roles: ["ANALYST"], clientIds: ["cli_a"] },
      after: { roles: ["CHECKER"], clientIds: ["cli_b"] },
    });
    expect(event!.actor).toBe(`user:${admin.userId}`);
  });
});

describe("reseeding keeps identity state", () => {
  it("preserves users, roles, sessions and surviving client grants", async () => {
    const { replaceDataset } = await import("@/lib/seed/write");
    const { generate, DEV_PARAMS } = await import("@/lib/seed/generate");
    const ds = generate(DEV_PARAMS);
    const kept = ds.clients[0]!.id;
    await db
      .insert(t.clients)
      .values({
        id: kept,
        name: "K",
        industry: "x",
        facilityLimitCents: 1,
        paymentTermsDays: 30,
      })
      .onConflictDoNothing();
    const id = await analyst(["cli_a", kept]);
    await bindUser(db, TENANT, claims());
    const s = await createSession(db, id, true, now);
    await replaceDataset(db, ds);
    const live = await resolveSession(db, s.token, now, REALM);
    expect(live?.identity.roles).toEqual(["ANALYST"]);
    // cli_a is not in the generated dataset, so only the surviving grant stays.
    expect(live?.identity.clientGrants).toEqual([kept]);
    const history = await db
      .select({ action: t.auditEvents.action })
      .from(t.auditEvents);
    expect(history.map((h) => h.action)).toEqual(
      expect.arrayContaining(["USER_PROVISIONED", "SIGN_IN"]),
    );
  }, 60_000);
});
