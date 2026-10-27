import { and, eq, gt, isNull } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import type { IdentityContext, Role } from "@/lib/security/access";

import { randomToken, SESSION_TTL_MS, tokenHash } from "./tokens";

export interface VerifiedClaims {
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  mfa: boolean;
}

export type BindResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "NOT_PROVISIONED" | "DISABLED" | "IDENTITY_CONFLICT" };

/**
 * Find the provisioned user for verified claims. A user is matched by the
 * bound issuer and subject, or once by a verified email whose account has no
 * bound identity yet. Users are never created from a sign-in.
 */
export async function bindUser(
  db: Db,
  tenantId: string,
  claims: VerifiedClaims,
): Promise<BindResult> {
  return db.transaction(async (tx) => {
    const [bound] = await tx
      .select()
      .from(t.users)
      .where(
        and(
          eq(t.users.oidcIssuer, claims.issuer),
          eq(t.users.oidcSubject, claims.subject),
        ),
      );
    if (bound) {
      if (bound.tenantId !== tenantId)
        return { ok: false, reason: "IDENTITY_CONFLICT" } as const;
      return bound.active
        ? ({ ok: true, userId: bound.id } as const)
        : ({ ok: false, reason: "DISABLED" } as const);
    }
    if (!claims.email || !claims.emailVerified)
      return { ok: false, reason: "NOT_PROVISIONED" } as const;
    const [byEmail] = await tx
      .select()
      .from(t.users)
      .where(
        and(
          eq(t.users.tenantId, tenantId),
          eq(t.users.email, claims.email.toLowerCase()),
        ),
      );
    if (!byEmail) return { ok: false, reason: "NOT_PROVISIONED" } as const;
    if (byEmail.oidcSubject !== null)
      return { ok: false, reason: "IDENTITY_CONFLICT" } as const;
    if (!byEmail.active) return { ok: false, reason: "DISABLED" } as const;
    const won = await tx
      .update(t.users)
      .set({ oidcIssuer: claims.issuer, oidcSubject: claims.subject })
      .where(and(eq(t.users.id, byEmail.id), isNull(t.users.oidcSubject)))
      .returning({ issuer: t.users.oidcIssuer, subject: t.users.oidcSubject });
    // A concurrent first sign-in may have bound the account to another subject.
    if (
      won.length !== 1 ||
      won[0]!.issuer !== claims.issuer ||
      won[0]!.subject !== claims.subject
    )
      return { ok: false, reason: "IDENTITY_CONFLICT" } as const;
    return { ok: true, userId: byEmail.id } as const;
  });
}

export class UserNotActiveError extends Error {
  constructor() {
    super("User is not active");
  }
}

export async function createSession(
  db: Db,
  userId: string,
  mfa: boolean,
  now: Date,
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = randomToken();
  const sessionId = `ses_${randomToken().slice(0, 22)}`;
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.transaction(async (tx) => {
    // Serialise with setUserActive: never issue a session for a user being
    // disabled, even if it would only become usable after re-enabling.
    const [user] = await tx
      .select({ active: t.users.active })
      .from(t.users)
      .where(eq(t.users.id, userId))
      .for("update");
    if (!user?.active) throw new UserNotActiveError();
    await tx.insert(t.authSessions).values({
      id: sessionId,
      tokenSha256: tokenHash(token),
      userId,
      mfa,
      createdAt: now,
      expiresAt,
    });
    await tx.insert(t.auditEvents).values({
      id: `aud_login_${sessionId}`,
      actor: `user:${userId}`,
      action: "SIGN_IN",
      entityType: "auth_session",
      entityId: sessionId,
      payload: { mfa },
    });
  });
  return { token, sessionId, expiresAt };
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  displayName: string;
  email: string;
  identity: IdentityContext;
}

/** The live session for a browser token, or null if absent, expired or revoked. */
/** The identity realm this deployment accepts: one tenant, one issuer. */
export interface Realm {
  tenantId: string;
  issuer: string;
}

/**
 * Issuers compare exactly. The one exception is an origin-only issuer, where
 * "https://idp.example" and "https://idp.example/" (URL.href's form) are the
 * same; a path-bearing issuer's trailing slash stays significant.
 */
export function sameIssuer(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const x = new URL(a);
    const y = new URL(b);
    return (
      x.pathname === "/" &&
      y.pathname === "/" &&
      x.origin === y.origin &&
      !x.search &&
      !y.search
    );
  } catch {
    return false;
  }
}

export async function resolveSession(
  db: Db,
  token: string | undefined,
  now: Date,
  realm: Realm,
): Promise<ResolvedSession | null> {
  if (!token || token.length > 200) return null;
  // One read-only snapshot: a concurrent access change can never mix old
  // roles with new grants (or the reverse) in a single decision.
  return db.transaction(
    async (tx) => {
      const [row] = await tx
        .select({ session: t.authSessions, user: t.users })
        .from(t.authSessions)
        .innerJoin(t.users, eq(t.authSessions.userId, t.users.id))
        .where(
          and(
            eq(t.authSessions.tokenSha256, tokenHash(token)),
            isNull(t.authSessions.revokedAt),
            gt(t.authSessions.expiresAt, now),
            eq(t.users.active, true),
          ),
        );
      if (
        !row ||
        !row.user.oidcIssuer ||
        !row.user.oidcSubject ||
        row.user.tenantId !== realm.tenantId ||
        !sameIssuer(row.user.oidcIssuer, realm.issuer)
      )
        return null;
      const roles = await tx
        .select({ role: t.userRoles.role })
        .from(t.userRoles)
        .where(eq(t.userRoles.userId, row.user.id));
      const grants = await tx
        .select({ clientId: t.userClientGrants.clientId })
        .from(t.userClientGrants)
        .where(eq(t.userClientGrants.userId, row.user.id));
      return {
        sessionId: row.session.id,
        userId: row.user.id,
        displayName: row.user.displayName,
        email: row.user.email,
        identity: {
          subject: row.user.id,
          tenantId: row.user.tenantId,
          issuer: row.user.oidcIssuer,
          roles: roles.map((r) => r.role as Role),
          clientGrants: grants.map((g) => g.clientId).sort(),
          mfaSatisfied: row.session.mfa,
          authenticatedUntilMs: row.session.expiresAt.getTime(),
        },
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** Revoke one session (sign-out) or every live session of a user (admin). */
export async function revokeSessions(
  db: Db,
  target: { sessionId: string } | { userId: string },
  reason: "SIGN_OUT" | "ADMIN_REVOKE" | "USER_DISABLED",
  actor: string,
  now: Date,
): Promise<number> {
  return db.transaction(async (tx) => {
    const revoked = await tx
      .update(t.authSessions)
      .set({ revokedAt: now, revokedReason: reason })
      .where(
        and(
          "sessionId" in target
            ? eq(t.authSessions.id, target.sessionId)
            : eq(t.authSessions.userId, target.userId),
          isNull(t.authSessions.revokedAt),
        ),
      )
      .returning({ id: t.authSessions.id });
    if (revoked.length > 0)
      await tx.insert(t.auditEvents).values({
        id: `aud_revoke_${randomToken().slice(0, 16)}`,
        actor,
        action: "SESSION_REVOKED",
        entityType: "sessionId" in target ? "auth_session" : "user",
        entityId: "sessionId" in target ? target.sessionId : target.userId,
        payload: { reason, sessions: revoked.map((r) => r.id) },
      });
    return revoked.length;
  });
}
