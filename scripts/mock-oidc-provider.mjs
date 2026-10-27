/**
 * Local OpenID Connect provider for tests only (#109). Implements discovery,
 * JWKS, an authorization endpoint with a user picker, and a token endpoint
 * with client_secret_post and PKCE S256. Never deploy this.
 *
 *   node scripts/mock-oidc-provider.mjs   (port 4455, users from MOCK_OIDC_USERS JSON)
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { SignJWT, exportJWK, generateKeyPair } from "jose";

/**
 * @typedef {{ sub: string, email?: string, email_verified?: boolean,
 *   amr?: string[], acr?: string, issuerOverride?: string,
 *   emailInUserInfo?: boolean, verifiedInUserInfo?: boolean,
 *   userinfoSub?: string, userinfoEmail?: string,
 *   userinfoVerified?: boolean, verifiedOnlyInIdToken?: boolean,
 *   userinfoNoEmail?: boolean }} MockUser
 * @param {{ port?: number, clientId?: string, clientSecret?: string,
 *   users?: MockUser[], tls?: { key: string, cert: string } }} [options]
 */
export async function startMockIdp({
  port = 0,
  clientId = "credit-desk-test",
  clientSecret = "test-client-secret",
  users = /** @type {MockUser[]} */ ([]),
  tls = undefined,
} = {}) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "test-key",
    alg: "RS256",
    use: "sig",
  };
  const codes = new Map();
  const accessTokens = new Map();
  let issuer = "";

  /** @type {import("node:http").RequestListener} */
  const handler = async (req, res) => {
    const url = new URL(req.url, issuer || "http://127.0.0.1");
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    if (url.pathname === "/.well-known/openid-configuration")
      return send(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        userinfo_endpoint: `${issuer}/userinfo`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: [
          "client_secret_basic",
          "client_secret_post",
        ],
      });
    if (url.pathname === "/jwks") return send(200, { keys: [jwk] });
    if (url.pathname === "/userinfo") {
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
      const user = token ? accessTokens.get(token) : undefined;
      if (!user) return send(401, { error: "invalid_token" });
      return send(200, {
        sub: user.userinfoSub ?? user.sub,
        ...(user.userinfoNoEmail
          ? {}
          : { email: user.userinfoEmail ?? user.email }),
        email_verified: user.userinfoVerified ?? user.email_verified ?? true,
      });
    }
    if (url.pathname === "/authorize") {
      const p = url.searchParams;
      if (p.get("client_id") !== clientId)
        return send(400, { error: "invalid_client" });
      const chosen = p.get("mock_user");
      if (!chosen) {
        const buttons = users
          .map(
            (u) =>
              `<li><a href="${url.pathname}?${p.toString()}&mock_user=${encodeURIComponent(u.sub)}">Sign in as ${u.email ?? u.sub}</a></li>`,
          )
          .join("");
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(
          `<!doctype html><title>Test IdP</title><h1>Test identity provider</h1><ul>${buttons}</ul>`,
        );
      }
      const user = users.find((u) => u.sub === chosen);
      if (!user) return send(400, { error: "unknown_user" });
      const code = randomBytes(16).toString("base64url");
      codes.set(code, {
        user,
        nonce: p.get("nonce"),
        challenge: p.get("code_challenge"),
        redirectUri: p.get("redirect_uri"),
      });
      const back = new URL(p.get("redirect_uri"));
      back.searchParams.set("code", code);
      back.searchParams.set("state", p.get("state"));
      back.searchParams.set("iss", issuer);
      res.writeHead(302, { location: back.href });
      return res.end();
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const form = new URLSearchParams(raw);
      // Accept client_secret_basic (header) or client_secret_post (body).
      const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? "")?.[1];
      const [basicId, basicSecret] = basic
        ? Buffer.from(basic, "base64")
            .toString()
            .split(":")
            .map((v) => decodeURIComponent(v))
        : [form.get("client_id"), form.get("client_secret")];
      if (basicId !== clientId || basicSecret !== clientSecret)
        return send(401, { error: "invalid_client" });
      const grant = codes.get(form.get("code"));
      codes.delete(form.get("code"));
      const verifier = form.get("code_verifier") ?? "";
      const challenge = createHash("sha256")
        .update(verifier)
        .digest("base64url");
      if (
        !grant ||
        grant.challenge !== challenge ||
        grant.redirectUri !== form.get("redirect_uri")
      )
        return send(400, { error: "invalid_grant" });
      const now = Math.floor(Date.now() / 1000);
      const idToken = await new SignJWT({
        nonce: grant.nonce,
        // emailInUserInfo simulates IdPs that release email only via UserInfo.
        ...(grant.user.verifiedOnlyInIdToken
          ? { email_verified: true }
          : grant.user.emailInUserInfo
            ? {}
            : grant.user.verifiedInUserInfo
              ? { email: grant.user.email }
              : {
                  email: grant.user.email,
                  email_verified: grant.user.email_verified ?? true,
                }),
        ...(grant.user.amr ? { amr: grant.user.amr } : {}),
        ...(grant.user.acr ? { acr: grant.user.acr } : {}),
      })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(grant.user.issuerOverride ?? issuer)
        .setSubject(grant.user.sub)
        .setAudience(clientId)
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(privateKey);
      const accessToken = randomBytes(16).toString("base64url");
      accessTokens.set(accessToken, grant.user);
      return send(200, {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 300,
        id_token: idToken,
      });
    }
    send(404, { error: "not_found" });
  };
  const server = tls ? createTlsServer(tls, handler) : createServer(handler);
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = /** @type {import("node:net").AddressInfo} */ (
    server.address()
  );
  issuer = `${tls ? "https" : "http"}://127.0.0.1:${address.port}`;
  return {
    issuer,
    clientId,
    clientSecret,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const users = JSON.parse(process.env.MOCK_OIDC_USERS ?? "[]");
  const tls = process.env.MOCK_OIDC_TLS_KEY
    ? {
        key: readFileSync(process.env.MOCK_OIDC_TLS_KEY, "utf8"),
        cert: readFileSync(process.env.MOCK_OIDC_TLS_CERT ?? "", "utf8"),
      }
    : undefined;
  const idp = await startMockIdp({
    port: Number(process.env.MOCK_OIDC_PORT ?? 4455),
    users,
    tls,
    clientId: process.env.MOCK_OIDC_CLIENT_ID,
    clientSecret: process.env.MOCK_OIDC_CLIENT_SECRET,
  });
  console.log(JSON.stringify({ event: "mock_idp_ready", issuer: idp.issuer }));
}
