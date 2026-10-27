import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";
import { contentSecurityPolicy, securityHeaders } from "@/lib/security/headers";

const directives = (csp: string) =>
  new Map(
    csp.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name!, values];
    }),
  );

describe("security response headers (#197)", () => {
  it("blocks framing, plugins, foreign form posts and base changes", () => {
    const csp = directives(contentSecurityPolicy(false));
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
    expect(csp.get("form-action")).toEqual(["'self'"]);
    expect(csp.get("default-src")).toEqual(["'self'"]);
    // Must not break same-origin redirects on plain-HTTP origins.
    expect(csp.has("upgrade-insecure-requests")).toBe(false);
  });

  it("allows eval only in development", () => {
    expect(directives(contentSecurityPolicy(false)).get("script-src")).toEqual([
      "'self'",
      "'unsafe-inline'",
    ]);
    expect(directives(contentSecurityPolicy(true)).get("script-src")).toContain(
      "'unsafe-eval'",
    );
  });

  it("applies the full header set to every route", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe("/:path*");
    const keys = rules[0]!.headers.map((h) => h.key);
    expect(keys).toEqual([
      "Content-Security-Policy",
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]);
    expect(
      securityHeaders(false).find((h) => h.key === "X-Frame-Options")?.value,
    ).toBe("DENY");
  });
});
