import { describe, expect, it } from "vitest";

import { gateConfig, safeEqual, signSession, verifySession } from "@/lib/auth";

const SECRET = "x".repeat(32);

describe("signed sessions", () => {
  it("round-trips a valid token", async () => {
    const token = await signSession(
      { sid: "s1", name: "Ana", exp: 2_000 },
      SECRET,
    );
    expect(await verifySession(token, SECRET, 1_000)).toEqual({
      sid: "s1",
      name: "Ana",
      exp: 2_000,
    });
  });

  it("signs and validates a read-only public-demo claim", async () => {
    const token = await signSession(
      {
        sid: "public",
        name: "Public analyst",
        persona: "ANALYST",
        publicDemo: true,
        exp: 2000,
      },
      SECRET,
    );
    expect((await verifySession(token, SECRET, 1000))?.publicDemo).toBe(true);
    const body = token.split(".")[0];
    const forged = btoa(
      JSON.stringify({
        sid: "public",
        name: "Public analyst",
        persona: "ANALYST",
        exp: 2000,
      }),
    ).replace(/=+$/, "");
    expect(
      await verifySession(forged + "." + token.split(".")[1], SECRET, 1000),
    ).toBeNull();
    expect(body).not.toBe(forged);
  });

  it("rejects an expired token", async () => {
    const token = await signSession(
      { sid: "s1", name: "Ana", exp: 1_000 },
      SECRET,
    );
    expect(await verifySession(token, SECRET, 1_000)).toBeNull();
  });

  it("rejects a tampered payload or a different secret", async () => {
    const token = await signSession(
      { sid: "s1", name: "Ana", exp: 2_000 },
      SECRET,
    );
    const [, sig] = token.split(".");
    const forged = `${btoa(JSON.stringify({ sid: "s2", name: "Eve", exp: 9_999 })).replace(/=+$/, "")}.${sig}`;
    expect(await verifySession(forged, SECRET, 1_000)).toBeNull();
    expect(await verifySession(token, "y".repeat(32), 1_000)).toBeNull();
    expect(await verifySession("garbage", SECRET, 1_000)).toBeNull();
    expect(await verifySession(undefined, SECRET, 1_000)).toBeNull();
  });
});

describe("password comparison", () => {
  it("compares equal and unequal strings", async () => {
    expect(await safeEqual("correct horse", "correct horse")).toBe(true);
    expect(await safeEqual("correct horse", "correct hors")).toBe(false);
  });
});

describe("gate configuration", () => {
  it("fails closed in production when secrets are missing", () => {
    expect(
      gateConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv),
    ).toMatchObject({ configured: false, enforce: true });
  });
  it("is off in development when unconfigured, on when configured", () => {
    expect(
      gateConfig({ NODE_ENV: "development" } as NodeJS.ProcessEnv).enforce,
    ).toBe(false);
    expect(
      gateConfig({
        NODE_ENV: "development",
        DEMO_PASSWORD: "p",
        SESSION_SECRET: SECRET,
      } as NodeJS.ProcessEnv).enforce,
    ).toBe(true);
  });
  it("requires a 32-character session secret", () => {
    expect(
      gateConfig({
        NODE_ENV: "production",
        DEMO_PASSWORD: "p",
        SESSION_SECRET: "short",
      } as NodeJS.ProcessEnv).configured,
    ).toBe(false);
  });
});
