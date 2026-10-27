import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { oidcConfig, type OidcConfig } from "@/lib/identity/config";
import { beginSignIn, completeSignIn } from "@/lib/identity/oidc";
import { startMockIdp } from "../../scripts/mock-oidc-provider.mjs";

let idp: {
  issuer: string;
  clientId: string;
  clientSecret: string;
  close: () => Promise<void>;
};
let oidc: OidcConfig;

beforeAll(async () => {
  idp = await startMockIdp({
    users: [
      { sub: "sub-mfa", email: "analyst@bank.test", amr: ["pwd", "otp"] },
      { sub: "sub-password", email: "single@bank.test", amr: ["pwd"] },
      {
        sub: "sub-forged",
        email: "x@bank.test",
        amr: ["otp"],
        issuerOverride: "https://evil.test",
      },
      {
        sub: "sub-userinfo",
        email: "ui@bank.test",
        amr: ["mfa"],
        emailInUserInfo: true,
      },
      {
        sub: "sub-verify-ui",
        email: "vui@bank.test",
        amr: ["mfa"],
        verifiedInUserInfo: true,
      },
      {
        sub: "sub-email-mismatch",
        email: "real@bank.test",
        amr: ["mfa"],
        verifiedInUserInfo: true,
        userinfoEmail: "other@bank.test",
      },
      {
        sub: "sub-flag-only",
        email: "flag@bank.test",
        amr: ["mfa"],
        verifiedOnlyInIdToken: true,
        userinfoVerified: false,
      },
      {
        sub: "sub-flag-without-email",
        email: "noflag@bank.test",
        amr: ["mfa"],
        verifiedInUserInfo: true,
        userinfoNoEmail: true,
      },
      {
        sub: "sub-mismatch",
        email: "mm@bank.test",
        amr: ["mfa"],
        emailInUserInfo: true,
        userinfoSub: "someone-else",
      },
    ],
  });
  oidc = oidcConfig({
    OIDC_ISSUER: idp.issuer,
    OIDC_CLIENT_ID: idp.clientId,
    OIDC_CLIENT_SECRET: idp.clientSecret,
    OIDC_REDIRECT_URI: "http://127.0.0.1:3999/auth/callback",
    CREDIT_DESK_TENANT_ID: "bank-test",
    SESSION_SECRET: "s".repeat(48),
    OIDC_ALLOW_HTTP: "1",
    NODE_ENV: "test",
  });
});
afterAll(() => idp.close());

async function authorize(sub: string) {
  const { url, transaction } = await beginSignIn(oidc, "/queue", Date.now());
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("state")).toBe(transaction.state);
  url.searchParams.set("mock_user", sub);
  const res = await fetch(url, { redirect: "manual" });
  return { callback: new URL(res.headers.get("location")!), transaction };
}

describe("OIDC authorization code flow (#109)", () => {
  it("verifies the ID token and reports MFA from amr", async () => {
    const { callback, transaction } = await authorize("sub-mfa");
    const claims = await completeSignIn(oidc, callback, transaction);
    expect(claims).toMatchObject({
      issuer: idp.issuer,
      subject: "sub-mfa",
      email: "analyst@bank.test",
      emailVerified: true,
      mfa: true,
    });
  });

  it("reports a password-only sign-in as not multi-factor", async () => {
    const { callback, transaction } = await authorize("sub-password");
    expect((await completeSignIn(oidc, callback, transaction)).mfa).toBe(false);
  });

  it("rejects a mismatched state", async () => {
    const { callback, transaction } = await authorize("sub-mfa");
    await expect(
      completeSignIn(oidc, callback, { ...transaction, state: "other" }),
    ).rejects.toThrow();
  });

  it("rejects a mismatched nonce", async () => {
    const { callback, transaction } = await authorize("sub-mfa");
    await expect(
      completeSignIn(oidc, callback, { ...transaction, nonce: "other" }),
    ).rejects.toThrow();
  });

  it("rejects a wrong PKCE verifier and a replayed code", async () => {
    const first = await authorize("sub-mfa");
    await expect(
      completeSignIn(oidc, first.callback, {
        ...first.transaction,
        codeVerifier: "x".repeat(43),
      }),
    ).rejects.toThrow();
    const second = await authorize("sub-mfa");
    await completeSignIn(oidc, second.callback, second.transaction);
    await expect(
      completeSignIn(oidc, second.callback, second.transaction),
    ).rejects.toThrow();
  });

  it("reads a verified email from UserInfo when the ID token omits it", async () => {
    const { callback, transaction } = await authorize("sub-userinfo");
    expect(await completeSignIn(oidc, callback, transaction)).toMatchObject({
      subject: "sub-userinfo",
      email: "ui@bank.test",
      emailVerified: true,
    });
  });

  it("reads email verification from UserInfo when the ID token omits it", async () => {
    const { callback, transaction } = await authorize("sub-verify-ui");
    expect(await completeSignIn(oidc, callback, transaction)).toMatchObject({
      email: "vui@bank.test",
      emailVerified: true,
    });
  });

  it("treats disagreeing ID token and UserInfo emails as unverified", async () => {
    const { callback, transaction } = await authorize("sub-email-mismatch");
    expect(
      (await completeSignIn(oidc, callback, transaction)).emailVerified,
    ).toBe(false);
  });

  it("never lends an ID token verification flag to an unverified UserInfo email", async () => {
    const { callback, transaction } = await authorize("sub-flag-only");
    const claims = await completeSignIn(oidc, callback, transaction);
    expect(claims.email).toBe("flag@bank.test");
    expect(claims.emailVerified).toBe(false);
  });

  it("ignores a UserInfo verification flag that names no address", async () => {
    const { callback, transaction } = await authorize("sub-flag-without-email");
    expect(
      (await completeSignIn(oidc, callback, transaction)).emailVerified,
    ).toBe(false);
  });

  it("rejects UserInfo for a different subject", async () => {
    const { callback, transaction } = await authorize("sub-mismatch");
    await expect(completeSignIn(oidc, callback, transaction)).rejects.toThrow();
  });

  it("supports client_secret_post when registered", async () => {
    const post = {
      ...oidc,
      tokenAuth: "client_secret_post" as const,
      clientId: oidc.clientId,
    };
    const { url, transaction } = await beginSignIn(post, "/", Date.now());
    url.searchParams.set("mock_user", "sub-mfa");
    const res = await fetch(url, { redirect: "manual" });
    const claims = await completeSignIn(
      post,
      new URL(res.headers.get("location")!),
      transaction,
    );
    expect(claims.subject).toBe("sub-mfa");
  });

  it("rejects an ID token from another issuer", async () => {
    const { callback, transaction } = await authorize("sub-forged");
    await expect(completeSignIn(oidc, callback, transaction)).rejects.toThrow();
  });

  it("allows loopback redirects but not remote plain-HTTP ones", () => {
    const base: NodeJS.ProcessEnv = {
      OIDC_ISSUER: "https://idp.bank.test",
      OIDC_CLIENT_ID: "c",
      OIDC_CLIENT_SECRET: "s",
      CREDIT_DESK_TENANT_ID: "bank-test",
      SESSION_SECRET: "s".repeat(48),
      NODE_ENV: "production",
    };
    expect(
      oidcConfig({
        ...base,
        OIDC_REDIRECT_URI: "http://127.0.0.1:3000/auth/callback",
      }).redirectUri.port,
    ).toBe("3000");
    expect(() =>
      oidcConfig({
        ...base,
        OIDC_REDIRECT_URI: "http://app.bank.test/auth/callback",
      }),
    ).toThrow(/HTTPS/);
  });

  it("refuses plain-HTTP issuers outside tests", () => {
    expect(() =>
      oidcConfig({
        OIDC_ISSUER: idp.issuer,
        OIDC_CLIENT_ID: "c",
        OIDC_CLIENT_SECRET: "s",
        OIDC_REDIRECT_URI: "https://app.test/auth/callback",
        CREDIT_DESK_TENANT_ID: "bank-test",
        SESSION_SECRET: "s".repeat(48),
        OIDC_ALLOW_HTTP: "1",
        NODE_ENV: "production",
      }),
    ).toThrow(/HTTPS/);
  });
});
