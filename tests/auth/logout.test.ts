import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_COOKIE } from "@/lib/auth";

const mocks = vi.hoisted(() => ({
  deleteCookie: vi.fn(),
  redirectTo: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ delete: mocks.deleteCookie }),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    mocks.redirectTo(path);
    throw new Error("NEXT_REDIRECT");
  },
}));

// The exit path never needs a database or the server-only rate limiter.
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ takeAll: vi.fn() }));

import { logoutAction } from "@/app/login/actions";

describe("demo account exits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("signs out by clearing both cookies and returning to login", async () => {
    await expect(logoutAction()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.deleteCookie).toHaveBeenCalledWith(AUTH_COOKIE);
    expect(mocks.deleteCookie).toHaveBeenCalledWith("cd_mode");
    expect(mocks.redirectTo).toHaveBeenCalledWith("/login");
  });

  it("clears the same cookies before focusing the role chooser", async () => {
    const form = new FormData();
    form.set("intent", "switch");
    await expect(logoutAction(form)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.deleteCookie).toHaveBeenCalledWith(AUTH_COOKIE);
    expect(mocks.deleteCookie).toHaveBeenCalledWith("cd_mode");
    expect(mocks.redirectTo).toHaveBeenCalledWith("/login#quick-demo-title");
  });

  it("does not allow arbitrary form values to control the redirect", async () => {
    const form = new FormData();
    form.set("intent", "//attacker.example");
    await expect(logoutAction(form)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirectTo).toHaveBeenCalledWith("/login");
  });
});
