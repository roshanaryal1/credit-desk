import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import type { Role } from "@/lib/security/access";

import { ROLES } from "./policy";
import { randomToken } from "./tokens";

export const AccessInput = z.object({
  roles: z.array(z.enum(ROLES as [Role, ...Role[]])).max(ROLES.length),
  clientIds: z.array(z.string().min(1).max(64)).max(500),
});

export const NewUserInput = AccessInput.extend({
  email: z.string().trim().toLowerCase().email().max(254),
  displayName: z.string().trim().min(2).max(80),
});

export interface Admin {
  userId: string;
  tenantId: string;
}

export type AdminResult =
  { ok: true; userId: string } | { ok: false; message: string };

async function audit(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  admin: Admin,
  action: string,
  userId: string,
  payload: Record<string, unknown>,
) {
  await tx.insert(t.auditEvents).values({
    id: `aud_admin_${randomToken().slice(0, 16)}`,
    actor: `user:${admin.userId}`,
    action,
    entityType: "user",
    entityId: userId,
    payload,
  });
}

async function knownClients(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  clientIds: string[],
): Promise<boolean> {
  if (clientIds.length === 0) return true;
  const rows = await tx
    .select({ id: t.clients.id })
    .from(t.clients)
    .where(inArray(t.clients.id, clientIds));
  return rows.length === new Set(clientIds).size;
}

async function replaceAccess(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  userId: string,
  roles: Role[],
  clientIds: string[],
) {
  await tx.delete(t.userRoles).where(eq(t.userRoles.userId, userId));
  await tx
    .delete(t.userClientGrants)
    .where(eq(t.userClientGrants.userId, userId));
  const uniqueRoles = [...new Set(roles)];
  const uniqueClients = [...new Set(clientIds)];
  if (uniqueRoles.length)
    await tx
      .insert(t.userRoles)
      .values(uniqueRoles.map((role) => ({ userId, role })));
  if (uniqueClients.length)
    await tx
      .insert(t.userClientGrants)
      .values(uniqueClients.map((clientId) => ({ userId, clientId })));
}

/** Provision a user. Sign-in later binds their OIDC identity by verified email. */
export async function provisionUser(
  db: Db,
  admin: Admin,
  input: z.infer<typeof NewUserInput>,
): Promise<AdminResult> {
  // Normalise here too: binding compares lower-cased verified emails.
  const email = input.email.trim().toLowerCase();
  return db.transaction(async (tx) => {
    if (!(await knownClients(tx, input.clientIds)))
      return { ok: false, message: "Unknown client in grants." } as const;
    const [existing] = await tx
      .select({ id: t.users.id })
      .from(t.users)
      .where(
        and(eq(t.users.tenantId, admin.tenantId), eq(t.users.email, email)),
      );
    if (existing)
      return { ok: false, message: "A user with that email exists." } as const;
    const userId = `usr_${randomToken().slice(0, 16)}`;
    await tx.insert(t.users).values({
      id: userId,
      tenantId: admin.tenantId,
      email,
      displayName: input.displayName,
    });
    await replaceAccess(tx, userId, input.roles, input.clientIds);
    await audit(tx, admin, "USER_PROVISIONED", userId, {
      email,
      roles: [...new Set(input.roles)].sort(),
      clientIds: [...new Set(input.clientIds)].sort(),
    });
    return { ok: true, userId } as const;
  });
}

async function tenantUser(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  admin: Admin,
  userId: string,
) {
  // Lock the row so concurrent administrators apply whole updates in turn.
  const [user] = await tx
    .select()
    .from(t.users)
    .where(and(eq(t.users.id, userId), eq(t.users.tenantId, admin.tenantId)))
    .for("update");
  return user;
}

/** Replace a user's roles and client grants, audited with before and after. */
export async function updateAccess(
  db: Db,
  admin: Admin,
  userId: string,
  input: z.infer<typeof AccessInput>,
): Promise<AdminResult> {
  return db.transaction(async (tx) => {
    const user = await tenantUser(tx, admin, userId);
    if (!user) return { ok: false, message: "User not found." } as const;
    if (userId === admin.userId && !input.roles.includes("ADMIN"))
      return {
        ok: false,
        message: "You cannot remove your own administrator role.",
      } as const;
    if (!(await knownClients(tx, input.clientIds)))
      return { ok: false, message: "Unknown client in grants." } as const;
    const [roles, grants] = await Promise.all([
      tx
        .select({ role: t.userRoles.role })
        .from(t.userRoles)
        .where(eq(t.userRoles.userId, userId)),
      tx
        .select({ clientId: t.userClientGrants.clientId })
        .from(t.userClientGrants)
        .where(eq(t.userClientGrants.userId, userId)),
    ]);
    await replaceAccess(tx, userId, input.roles, input.clientIds);
    await audit(tx, admin, "USER_ACCESS_CHANGED", userId, {
      before: {
        roles: roles.map((r) => r.role).sort(),
        clientIds: grants.map((g) => g.clientId).sort(),
      },
      after: {
        roles: [...new Set(input.roles)].sort(),
        clientIds: [...new Set(input.clientIds)].sort(),
      },
    });
    return { ok: true, userId } as const;
  });
}

/** Enable or disable a user. Disabling revokes every live session at once. */
export async function setUserActive(
  db: Db,
  admin: Admin,
  userId: string,
  active: boolean,
  now: Date,
): Promise<AdminResult> {
  return db.transaction(async (tx) => {
    const user = await tenantUser(tx, admin, userId);
    if (!user) return { ok: false, message: "User not found." } as const;
    if (userId === admin.userId && !active)
      return {
        ok: false,
        message: "You cannot disable your own account.",
      } as const;
    await tx.update(t.users).set({ active }).where(eq(t.users.id, userId));
    const revoked = active
      ? []
      : await tx
          .update(t.authSessions)
          .set({ revokedAt: now, revokedReason: "USER_DISABLED" })
          .where(
            and(
              eq(t.authSessions.userId, userId),
              isNull(t.authSessions.revokedAt),
            ),
          )
          .returning({ id: t.authSessions.id });
    await audit(tx, admin, active ? "USER_ENABLED" : "USER_DISABLED", userId, {
      revokedSessions: revoked.map((r) => r.id),
    });
    return { ok: true, userId } as const;
  });
}

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  active: boolean;
  bound: boolean;
  roles: Role[];
  clientIds: string[];
  liveSessions: number;
}

export async function listUsers(
  db: Db,
  tenantId: string,
  now: Date,
): Promise<UserRow[]> {
  const users = await db
    .select()
    .from(t.users)
    .where(eq(t.users.tenantId, tenantId))
    .orderBy(t.users.email);
  if (users.length === 0) return [];
  const ids = users.map((u) => u.id);
  const [roles, grants, sessions] = await Promise.all([
    db.select().from(t.userRoles).where(inArray(t.userRoles.userId, ids)),
    db
      .select()
      .from(t.userClientGrants)
      .where(inArray(t.userClientGrants.userId, ids)),
    db
      .select({ userId: t.authSessions.userId, n: sql<number>`count(*)::int` })
      .from(t.authSessions)
      .where(
        and(
          inArray(t.authSessions.userId, ids),
          isNull(t.authSessions.revokedAt),
          gt(t.authSessions.expiresAt, now),
        ),
      )
      .groupBy(t.authSessions.userId),
  ]);
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    active: u.active,
    bound: u.oidcSubject !== null,
    roles: roles
      .filter((r) => r.userId === u.id)
      .map((r) => r.role as Role)
      .sort(),
    clientIds: grants
      .filter((g) => g.userId === u.id)
      .map((g) => g.clientId)
      .sort(),
    liveSessions: sessions.find((s) => s.userId === u.id)?.n ?? 0,
  }));
}
