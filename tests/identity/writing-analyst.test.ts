import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as unknown,
  sequence: [] as unknown[],
}));
vi.mock("@/lib/identity/current", () => ({
  currentSession: async () =>
    state.sequence.length ? state.sequence.shift() : state.session,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/server", () => ({ connection: async () => {} }));

const { writingAnalyst } = await import("@/lib/session");

afterEach(() => {
  vi.unstubAllEnvs();
  state.session = null;
  state.sequence = [];
});

describe("write attribution in identity mode (#109)", () => {
  it("refuses to attribute a write without a verified session", async () => {
    vi.stubEnv("AUTH_MODE", "oidc");
    expect(await writingAnalyst()).toBeNull();
  });
  it("attributes a write to the verified user and session", async () => {
    vi.stubEnv("AUTH_MODE", "oidc");
    state.session = { sessionId: "ses_abc", displayName: "Ana Lyst" };
    expect(await writingAnalyst()).toEqual({
      sessionId: "ses_abc",
      displayName: "Ana Lyst",
      mode: "SHADOW",
    });
  });
  it("never falls back to an unverified actor when the session ends mid-write", async () => {
    vi.stubEnv("AUTH_MODE", "oidc");
    // A live session on the first lookup, revoked on any later one.
    state.sequence = [
      { sessionId: "ses_abc", displayName: "Ana Lyst" },
      null,
      null,
    ];
    const actor = await writingAnalyst();
    expect(actor?.displayName).toBe("Ana Lyst");
    expect(actor?.sessionId).toBe("ses_abc");
  });
});
