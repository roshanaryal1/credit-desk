import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_COOKIE, signSession, verifySession } from "@/lib/auth";

const SECRET = "s".repeat(48);
const jar = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "cd_auth" && jar.value ? { value: jar.value } : undefined,
  }),
}));
vi.mock("next/server", () => ({ connection: async () => {} }));

const { canPerformDemoWrite } = await import("@/lib/demo-session");

const token = (extra: Record<string, unknown>) =>
  signSession(
    {
      sid: "11111111-1111-4111-8111-111111111111",
      name: "Public Credit analyst demo",
      persona: "ANALYST",
      exp: Math.floor(Date.now() / 1000) + 600,
      ...extra,
    } as Parameters<typeof signSession>[0],
    SECRET,
  );

beforeEach(() => {
  vi.stubEnv("DEMO_PASSWORD", "synthetic-test");
  vi.stubEnv("SESSION_SECRET", SECRET);
  jar.value = undefined;
});

describe("one-click write access (#217)", () => {
  it("lets a newly issued public analyst write", async () => {
    jar.value = await token({ publicDemo: true, publicWrites: true });
    expect(await canPerformDemoWrite()).toBe(true);
  });
  it("keeps public analyst cookies issued before the change read-only", async () => {
    jar.value = await token({ publicDemo: true });
    expect(await canPerformDemoWrite()).toBe(false);
  });
  it("keeps every other public perspective read-only", async () => {
    for (const persona of ["EMPLOYER", "CHECKER", "CLIENT", "AUDITOR"]) {
      jar.value = await token({
        persona,
        publicDemo: true,
        publicWrites: true,
      });
      expect(await canPerformDemoWrite()).toBe(false);
    }
  });
  it("rejects a malformed write claim", async () => {
    const forged = await token({ publicDemo: true, publicWrites: "yes" });
    expect(await verifySession(forged, SECRET)).toBeNull();
  });
  it("uses the auth cookie name the proxy reads", () => {
    expect(AUTH_COOKIE).toBe("cd_auth");
  });
});
