import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const SESSION_COOKIE = "cd_session";
export const LOGIN_COOKIE = "cd_oidc_login";
/** Absolute session lifetime; re-authentication is required afterwards. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
/** Time allowed between redirecting to the IdP and the callback. */
export const LOGIN_TTL_MS = 10 * 60 * 1000;

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Signed, expiring JSON for the short-lived login transaction cookie. */
export function sealLogin(value: LoginTransaction, secret: string): string {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  const sig = createHmac("sha256", secret).update(`login.${body}`).digest();
  return `${body}.${sig.toString("base64url")}`;
}

export interface LoginTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  next: string;
  expiresAtMs: number;
}

export function openLogin(
  sealed: string | undefined,
  secret: string,
  nowMs: number,
): LoginTransaction | null {
  if (!sealed) return null;
  const [body, sig] = sealed.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret)
    .update(`login.${body}`)
    .digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return null;
  try {
    const value = JSON.parse(
      Buffer.from(body, "base64url").toString(),
    ) as LoginTransaction;
    if (
      typeof value.state !== "string" ||
      typeof value.nonce !== "string" ||
      typeof value.codeVerifier !== "string" ||
      typeof value.next !== "string" ||
      typeof value.expiresAtMs !== "number" ||
      value.expiresAtMs <= nowMs
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
