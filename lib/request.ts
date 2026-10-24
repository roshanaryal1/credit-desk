// Request metadata that rate limits can trust.

/**
 * The client address for rate limiting. On Vercel, x-vercel-forwarded-for is
 * set by the platform and cannot be supplied by the client; x-real-ip is set
 * by common reverse proxies. A client-supplied X-Forwarded-For is never
 * trusted, because its first entry is attacker-controlled. Without a trusted
 * source every request shares one bucket, so the global caps still apply.
 */
export function clientIp(headers: Headers): string {
  const vercel = headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercel) return vercel;
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "untrusted";
}

/**
 * A same-site path to redirect to after sign-in, or "/". The value is parsed
 * as a URL so control characters and protocol-relative tricks (such as
 * "/\t/evil.example") cannot escape the site.
 */
export function safeNext(next: string | undefined | null): string {
  if (!next || /[\u0000-\u001f\u007f\\]/.test(next) || !next.startsWith("/"))
    return "/";
  try {
    const base = "http://credit-desk.invalid";
    const url = new URL(next, base);
    if (url.origin !== base) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
