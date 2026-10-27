import "server-only";

import * as client from "openid-client";

import type { OidcConfig } from "./config";
import { mfaSatisfied } from "./policy";
import type { VerifiedClaims } from "./store";
import { LOGIN_TTL_MS, type LoginTransaction } from "./tokens";

let cached: { key: string; config: Promise<client.Configuration> } | null =
  null;

function discover(oidc: OidcConfig): Promise<client.Configuration> {
  const key = `${oidc.issuer.href}|${oidc.clientId}|${oidc.tokenAuth}`;
  if (cached?.key !== key) {
    const config = client
      .discovery(
        oidc.issuer,
        oidc.clientId,
        undefined,
        oidc.tokenAuth === "client_secret_post"
          ? client.ClientSecretPost(oidc.clientSecret)
          : client.ClientSecretBasic(oidc.clientSecret),
        oidc.allowHttp
          ? { execute: [client.allowInsecureRequests] }
          : undefined,
      )
      .catch((error: unknown) => {
        cached = null; // Retry discovery on the next sign-in.
        throw error;
      });
    cached = { key, config };
  }
  return cached.config;
}

/** Start an authorization code flow with PKCE, state and nonce. */
export async function beginSignIn(
  oidc: OidcConfig,
  next: string,
  nowMs: number,
): Promise<{ url: URL; transaction: LoginTransaction }> {
  const config = await discover(oidc);
  const codeVerifier = client.randomPKCECodeVerifier();
  const transaction: LoginTransaction = {
    state: client.randomState(),
    nonce: client.randomNonce(),
    codeVerifier,
    next,
    expiresAtMs: nowMs + LOGIN_TTL_MS,
  };
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: oidc.redirectUri.href,
    scope: "openid email profile",
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: "S256",
    state: transaction.state,
    nonce: transaction.nonce,
  });
  return { url, transaction };
}

/**
 * Exchange the code and verify the ID token (signature, issuer, audience,
 * expiry, nonce) through openid-client. Returns only the claims we trust.
 */
export async function completeSignIn(
  oidc: OidcConfig,
  callbackUrl: URL,
  transaction: LoginTransaction,
): Promise<VerifiedClaims> {
  const config = await discover(oidc);
  const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: transaction.codeVerifier,
    expectedState: transaction.state,
    expectedNonce: transaction.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims) throw new Error("ID token missing");
  let email = typeof claims.email === "string" ? claims.email : null;
  let emailVerified = !!email && claims.email_verified === true;
  const needUserInfo = !email || claims.email_verified === undefined;
  if (needUserInfo && config.serverMetadata().userinfo_endpoint) {
    // Some IdPs release email or its verification only through UserInfo.
    // openid-client checks that its subject matches the ID token's subject.
    const info = await client.fetchUserInfo(
      config,
      tokens.access_token,
      claims.sub,
    );
    const infoEmail = typeof info.email === "string" ? info.email : null;
    const infoVerified = info.email_verified === true;
    if (!email) {
      // The address comes from UserInfo, so only UserInfo can verify it.
      email = infoEmail;
      emailVerified = !!infoEmail && infoVerified;
    } else if (infoEmail && infoEmail.toLowerCase() !== email.toLowerCase()) {
      // Disagreeing sources never count as a verified email.
      emailVerified = false;
    } else if (claims.email_verified === undefined) {
      // A verification flag only counts for the address it accompanies.
      emailVerified = !!infoEmail && infoVerified;
    }
  }
  return {
    issuer: claims.iss,
    subject: claims.sub,
    email,
    emailVerified,
    mfa: mfaSatisfied({ amr: claims.amr, acr: claims.acr }, oidc),
  };
}
