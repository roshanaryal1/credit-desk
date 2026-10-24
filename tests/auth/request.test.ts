import { describe, expect, it } from "vitest";

import { clientIp, safeNext } from "@/lib/request";

describe("safeNext", () => {
  it("keeps same-site paths with query and hash", () => {
    expect(safeNext("/batches/bat_0007?invoice=inv_1#ev")).toBe(
      "/batches/bat_0007?invoice=inv_1#ev",
    );
  });
  it.each([
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/%09/evil.example".replace("%09", "\t"),
    "https://evil.example",
    "evil",
    "",
    null,
  ])("rejects %s", (next) => {
    expect(safeNext(next as string | null)).toBe("/");
  });
});

describe("clientIp", () => {
  it("never trusts a client-supplied X-Forwarded-For", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4" }))).toBe(
      "untrusted",
    );
  });
  it("uses the platform-set Vercel header, then x-real-ip", () => {
    expect(
      clientIp(
        new Headers({
          "x-vercel-forwarded-for": "5.6.7.8",
          "x-forwarded-for": "1.2.3.4",
        }),
      ),
    ).toBe("5.6.7.8");
    expect(clientIp(new Headers({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
  });
});
