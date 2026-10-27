import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AUTH_COOKIE, signSession } from "@/lib/auth";
import { proxy } from "@/proxy";

const SECRET = "s".repeat(48);
const saved = { ...process.env };

beforeAll(() => {
  process.env.DEMO_PASSWORD = "synthetic-test-password";
  process.env.SESSION_SECRET = SECRET;
});
afterAll(() => {
  process.env = saved;
});

async function request(
  path: string,
  init: { persona?: "ANALYST" | "CLIENT"; exp?: number; action?: boolean },
) {
  const headers = new Headers();
  if (init.action) headers.set("next-action", "7f0000000000000000000000000000");
  if (init.persona) {
    const token = await signSession(
      {
        sid: "11111111-1111-4111-8111-111111111111",
        name: "Test",
        persona: init.persona,
        exp: init.exp ?? Math.floor(Date.now() / 1000) + 600,
      },
      SECRET,
    );
    headers.set("cookie", `${AUTH_COOKIE}=${token}`);
  }
  return proxy(
    new NextRequest(`http://localhost${path}`, {
      method: init.action ? "POST" : "GET",
      headers,
    }),
  );
}

describe("proxy redirects for server actions (#199)", () => {
  const invoice = "/batches/bat_0008?invoice=inv_0222";

  it("tells an expired session's action to navigate to sign-in", async () => {
    const res = await request(invoice, {
      persona: "ANALYST",
      exp: 1,
      action: true,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-action-redirect")).toBe(
      `/login?next=${encodeURIComponent(invoice)};push`,
    );
    expect(res.headers.get("x-middleware-next")).toBeNull();
    expect(await res.text()).toBe("");
  });

  it("sends an action from a persona without route access to its home", async () => {
    const res = await request(invoice, { persona: "CLIENT", action: true });
    expect(res.headers.get("x-action-redirect")).toBe("/demo/client;push");
    expect(res.headers.get("x-middleware-next")).toBeNull();
  });

  it("keeps HTTP redirects for page navigations", async () => {
    const expired = await request(invoice, { persona: "ANALYST", exp: 1 });
    expect(expired.status).toBe(307);
    expect(expired.headers.get("location")).toContain("/login?next=");
    expect(expired.headers.get("x-action-redirect")).toBeNull();
    const client = await request(invoice, { persona: "CLIENT" });
    expect(client.status).toBe(307);
    expect(new URL(client.headers.get("location")!).pathname).toBe(
      "/demo/client",
    );
  });

  it("lets an allowed session's action through to its own guard", async () => {
    const res = await request(invoice, { persona: "ANALYST", action: true });
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("x-action-redirect")).toBeNull();
  });
});
