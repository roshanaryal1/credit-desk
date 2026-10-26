// Baseline response headers for every route (#197). Uses the no-nonce CSP
// pattern from the Next.js 16 guide: a nonce would force dynamic rendering,
// which Partial Prerendering cannot use. Inline scripts therefore remain
// allowed; framing, plugins, foreign form posts and base changes do not.

export function contentSecurityPolicy(isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // No upgrade-insecure-requests: it rewrites same-origin redirects to
    // https on plain-HTTP origins (local production runs, CI smoke). The
    // hosted domain already enforces HTTPS with HSTS.
  ].join("; ");
}

export function securityHeaders(
  isDev: boolean,
): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(isDev) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
  ];
}
