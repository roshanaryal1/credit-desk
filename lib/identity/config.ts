import { z } from "zod";

/**
 * Identity mode (#109). "demo" keeps the shared-password synthetic gate.
 * "oidc" requires a verified OpenID Connect sign-in with provisioned users,
 * revocable database sessions and per-client grants.
 */
export type AuthMode = "demo" | "oidc";

export function authMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  return env.AUTH_MODE === "oidc" ? "oidc" : "demo";
}

const OidcEnv = z.object({
  OIDC_ISSUER: z.string().url(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  OIDC_REDIRECT_URI: z.string().url(),
  CREDIT_DESK_TENANT_ID: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  SESSION_SECRET: z.string().min(32),
});

export interface OidcConfig {
  issuer: URL;
  clientId: string;
  clientSecret: string;
  redirectUri: URL;
  tenantId: string;
  sessionSecret: string;
  /** `amr` values that by themselves prove multi-factor authentication. */
  mfaMethods: string[];
  /** Accepted `acr` values proving multi-factor authentication. */
  mfaAcr: string[];
  /** Plain-HTTP issuers are for local test IdPs only, never production. */
  allowHttp: boolean;
  /** Token endpoint client authentication registered at the IdP. */
  tokenAuth: "client_secret_basic" | "client_secret_post";
}

/** Throws with a non-secret message when configuration is missing or unsafe. */
export function oidcConfig(env: NodeJS.ProcessEnv = process.env): OidcConfig {
  const parsed = OidcEnv.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => String(i.path[0]));
    throw new Error(
      `OIDC is not configured: ${[...new Set(fields)].join(", ")}`,
    );
  }
  const issuer = new URL(parsed.data.OIDC_ISSUER);
  const redirectUri = new URL(parsed.data.OIDC_REDIRECT_URI);
  const allowHttp =
    env.OIDC_ALLOW_HTTP === "1" && env.NODE_ENV !== "production";
  if (issuer.protocol !== "https:" && !allowHttp)
    throw new Error("OIDC issuer and redirect URI must use HTTPS");
  // A loopback redirect never leaves the machine (RFC 8252 section 7.3).
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(
    redirectUri.hostname,
  );
  if (redirectUri.protocol !== "https:" && !allowHttp && !loopback)
    throw new Error("OIDC issuer and redirect URI must use HTTPS");
  const list = (value: string | undefined, fallback: string[]) =>
    value === undefined
      ? fallback
      : value
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
  return {
    issuer,
    clientId: parsed.data.OIDC_CLIENT_ID,
    clientSecret: parsed.data.OIDC_CLIENT_SECRET,
    redirectUri,
    tenantId: parsed.data.CREDIT_DESK_TENANT_ID,
    sessionSecret: parsed.data.SESSION_SECRET,
    // Methods that by themselves assert multiple factors (RFC 8176 "mfa").
    mfaMethods: list(env.OIDC_MFA_AMR, ["mfa"]),
    mfaAcr: list(env.OIDC_MFA_ACR, []),
    allowHttp,
    // OIDC's default method; set to client_secret_post when registered so.
    tokenAuth:
      env.OIDC_TOKEN_AUTH === "client_secret_post"
        ? "client_secret_post"
        : "client_secret_basic",
  };
}
