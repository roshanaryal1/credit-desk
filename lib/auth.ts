// Signed, expiring session tokens for the shared-password gate (SPEC 11).
// Web Crypto only, so the same code runs in proxy.ts and server actions.
// Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256).

export const AUTH_COOKIE = "cd_auth";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface SessionPayload {
  /** Random session id; also used for exposure and attribution. */
  sid: string;
  /** Self-declared display name (not verified). */
  name: string;
  /** Expiry, epoch seconds. */
  exp: number;
}

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad =
    s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSession(
  payload: SessionPayload,
  secret: string,
): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    enc.encode(body),
  );
  return `${body}.${b64url(sig)}`;
}

/** Returns the payload if the signature is valid and the token has not expired. */
export async function verifySession(
  token: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromB64url(sig),
      enc.encode(body),
    );
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const payload = JSON.parse(
      new TextDecoder().decode(fromB64url(body)),
    ) as SessionPayload;
    if (
      typeof payload.sid !== "string" ||
      typeof payload.exp !== "number" ||
      payload.exp <= nowSeconds
    )
      return null;
    return payload;
  } catch {
    return null;
  }
}

/** Constant-time string comparison (via HMAC of both values). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const key = await hmacKey("compare");
  const [x, y] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(a)),
    crypto.subtle.sign("HMAC", key, enc.encode(b)),
  ]);
  const ax = new Uint8Array(x);
  const by = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ax.length; i++) diff |= ax[i]! ^ by[i]!;
  return diff === 0;
}

/**
 * Gate configuration. Missing secrets disable the gate only outside
 * production; in production the app fails closed.
 */
export function gateConfig(env: NodeJS.ProcessEnv = process.env) {
  const password = env.DEMO_PASSWORD ?? "";
  const secret = env.SESSION_SECRET ?? "";
  const configured = password.length > 0 && secret.length >= 32;
  return {
    password,
    secret,
    configured,
    enforce: configured || env.NODE_ENV === "production",
  };
}
