import { describe, expect, it } from "vitest";

import {
  batchIdFromPath,
  clientIdFromPath,
  identityRouteAllowed,
  mfaSatisfied,
} from "@/lib/identity/policy";
import { openLogin, sealLogin } from "@/lib/identity/tokens";

describe("verified role routes (#109)", () => {
  it("scopes each role and unions multiple roles", () => {
    expect(identityRouteAllowed(["ANALYST"], "/queue")).toBe(true);
    expect(identityRouteAllowed(["ANALYST"], "/admin/users")).toBe(false);
    expect(identityRouteAllowed(["CHECKER"], "/audit")).toBe(false);
    // AUDIT_READ: auditors and risk managers only, even though the demo
    // analyst perspective lists /audit.
    expect(identityRouteAllowed(["ANALYST"], "/audit")).toBe(false);
    expect(identityRouteAllowed(["AUDITOR"], "/audit")).toBe(true);
    expect(identityRouteAllowed(["RISK_MANAGER"], "/audit")).toBe(true);
    expect(identityRouteAllowed(["AUDITOR"], "/queue")).toBe(false);
    expect(identityRouteAllowed(["AUDITOR", "CHECKER"], "/queue")).toBe(true);
    expect(identityRouteAllowed(["ADMIN"], "/admin/users")).toBe(true);
    expect(identityRouteAllowed(["ADMIN"], "/clients")).toBe(false);
    expect(identityRouteAllowed([], "/")).toBe(false);
    expect(identityRouteAllowed([], "/about")).toBe(true);
  });
  it("never serves the borrower demo to verified identities", () => {
    expect(
      identityRouteAllowed(["RISK_MANAGER", "ANALYST"], "/demo/client"),
    ).toBe(false);
  });
  it("extracts client and batch scope from paths", () => {
    expect(clientIdFromPath("/clients/cli_0002/activity")).toBe("cli_0002");
    expect(clientIdFromPath("/credit-memos/cli_0003/export")).toBe("cli_0003");
    expect(clientIdFromPath("/borrowing-base/clients/cli_0004")).toBe(
      "cli_0004",
    );
    expect(clientIdFromPath("/clients")).toBeNull();
    expect(batchIdFromPath("/batches/bat_0008")).toBe("bat_0008");
    expect(batchIdFromPath("/batches")).toBeNull();
  });
});

describe("MFA evaluation", () => {
  const policy = { mfaMethods: ["mfa"], mfaAcr: ["urn:bank:mfa"] };
  it("requires proof of multiple factors", () => {
    expect(mfaSatisfied({ amr: ["mfa"] }, policy)).toBe(true);
    expect(mfaSatisfied({ amr: ["pwd", "otp"] }, policy)).toBe(true);
    expect(mfaSatisfied({ amr: ["pwd", "hwk"] }, policy)).toBe(true);
    expect(mfaSatisfied({ acr: "urn:bank:mfa" }, policy)).toBe(true);
  });
  it("rejects single methods and malformed claims", () => {
    expect(mfaSatisfied({ amr: ["otp"] }, policy)).toBe(false);
    expect(mfaSatisfied({ amr: ["hwk", "otp"] }, policy)).toBe(false);
    expect(mfaSatisfied({ amr: ["pwd"] }, policy)).toBe(false);
    expect(mfaSatisfied({ amr: "mfa" }, policy)).toBe(false);
    expect(mfaSatisfied({ acr: "urn:other" }, policy)).toBe(false);
    expect(mfaSatisfied({}, policy)).toBe(false);
  });
});

describe("login transaction cookie", () => {
  const value = {
    state: "s",
    nonce: "n",
    codeVerifier: "v",
    next: "/queue",
    expiresAtMs: 2_000,
  };
  it("round-trips and rejects tampering, wrong keys and expiry", () => {
    const sealed = sealLogin(value, "k".repeat(40));
    expect(openLogin(sealed, "k".repeat(40), 1_000)).toEqual(value);
    expect(openLogin(sealed, "x".repeat(40), 1_000)).toBeNull();
    expect(openLogin(sealed, "k".repeat(40), 2_000)).toBeNull();
    const [body, sig] = sealed.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...value, next: "//evil" }),
    ).toString("base64url");
    expect(openLogin(`${forged}.${sig}`, "k".repeat(40), 1_000)).toBeNull();
    expect(openLogin(body, "k".repeat(40), 1_000)).toBeNull();
  });
});
