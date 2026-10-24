import { describe, it, expect } from "vitest";

import {
  authorize,
  requireAccess,
  type IdentityContext,
} from "@/lib/security/access";

const good: IdentityContext = {
  subject: "oidc-user-1",
  tenantId: "firm-a",
  clientGrants: ["client-1"],
  roles: ["ANALYST"],
  mfaSatisfied: false,
  issuer: "https://oidc.example.test",
  authenticatedUntilMs: 2000,
};

describe("least privilege policy", () => {
  it("allows scoped analyst reads and proposals, but never approval or transfers", () => {
    expect(
      authorize(
        good,
        { tenantId: "firm-a", clientId: "client-1" },
        "CLIENT_READ",
        1000,
      ).allowed,
    ).toBe(true);
    expect(
      authorize(
        good,
        { tenantId: "firm-a", clientId: "client-1" },
        "CASE_PROPOSE",
        1000,
      ).allowed,
    ).toBe(true);
    expect(
      authorize(
        good,
        { tenantId: "firm-a", clientId: "client-1" },
        "CASE_CHECK",
        1000,
      ),
    ).toMatchObject({ allowed: false, reason: "ROLE_REQUIRED" });
    expect(
      authorize(good, { tenantId: "firm-a" }, "FUNDING_EXECUTE", 1000),
    ).toMatchObject({ allowed: false, reason: "DISABLED" });
  });
  it("denies any cross-tenant or ungranted client access, including admin role", () => {
    const admin = {
      ...good,
      roles: ["ADMIN"] as IdentityContext["roles"],
      mfaSatisfied: true,
    };
    expect(
      authorize(
        admin,
        { tenantId: "firm-b", clientId: "client-1" },
        "CLIENT_READ",
        1000,
      ).allowed,
    ).toBe(false);
    expect(
      authorize(
        admin,
        { tenantId: "firm-a", clientId: "client-2" },
        "CLIENT_READ",
        1000,
      ),
    ).toMatchObject({ allowed: false, reason: "CLIENT_BOUNDARY" });
  });
  it("requires MFA for checker, audit, policy edit and integration management", () => {
    const person = {
      ...good,
      roles: [
        "CHECKER",
        "ADMIN",
        "RISK_MANAGER",
        "AUDITOR",
      ] as IdentityContext["roles"],
    };
    for (const action of [
      "CASE_CHECK",
      "POLICY_EDIT",
      "AUDIT_READ",
      "CONNECTION_MANAGE",
    ] as const) {
      expect(
        authorize(person, { tenantId: "firm-a" }, action, 1000),
      ).toMatchObject({ allowed: false, reason: "MFA_REQUIRED" });
      expect(
        authorize(
          { ...person, mfaSatisfied: true },
          { tenantId: "firm-a" },
          action,
          1000,
        ).allowed,
      ).toBe(true);
    }
  });
  it("fails on missing, expired, or unsigned-attribution contexts", () => {
    expect(
      authorize(null, { tenantId: "firm-a" }, "CLIENT_READ", 1000).allowed,
    ).toBe(false);
    expect(
      authorize(good, { tenantId: "firm-a" }, "CLIENT_READ", 2000),
    ).toMatchObject({ allowed: false, reason: "EXPIRED" });
    expect(
      authorize(
        { ...good, issuer: "" },
        { tenantId: "firm-a" },
        "CLIENT_READ",
        1000,
      ),
    ).toMatchObject({ allowed: false, reason: "NO_SESSION" });
    expect(() =>
      requireAccess(good, { tenantId: "firm-b" }, "CLIENT_READ", 1000),
    ).toThrow(/Access denied/);
  });
});
