import { describe, expect, it } from "vitest";

import {
  DEMO_PERSONA_KEYS,
  demoCanWrite,
  demoRouteAllowed,
  parseDemoPersona,
} from "@/lib/demo-personas";
import { signSession, verifySession } from "@/lib/auth";

describe("self-selected demo perspectives", () => {
  it("recognizes exactly five role identifiers", () => {
    expect(DEMO_PERSONA_KEYS).toEqual([
      "EMPLOYER",
      "ANALYST",
      "CHECKER",
      "CLIENT",
      "AUDITOR",
    ]);
    for (const persona of DEMO_PERSONA_KEYS) {
      expect(parseDemoPersona(persona)).toBe(persona);
    }
    expect(parseDemoPersona("ADMIN")).toBeNull();
    expect(parseDemoPersona("CLIENT;ADMIN")).toBeNull();
    expect(parseDemoPersona(null)).toBeNull();
    expect(parseDemoPersona("")).toBeNull();
  });

  it("limits the fictional client to a fixed read-only landing page", () => {
    expect(demoRouteAllowed("CLIENT", "/demo/client")).toBe(true);
    expect(demoRouteAllowed("CLIENT", "/about")).toBe(true);
    for (const path of [
      "/clients",
      "/clients/cli_0001",
      "/clients/cli_0002",
      "/queue",
      "/audit",
      "/trust",
      "/api/watch/run",
      "/demo/client/other",
    ])
      expect(demoRouteAllowed("CLIENT", path)).toBe(false);
  });

  it("limits checker and auditor perspectives to useful routes", () => {
    expect(demoRouteAllowed("CHECKER", "/queue")).toBe(true);
    expect(demoRouteAllowed("CHECKER", "/audit")).toBe(false);
    expect(demoRouteAllowed("AUDITOR", "/audit")).toBe(true);
    expect(demoRouteAllowed("AUDITOR", "/batches")).toBe(false);
    expect(demoRouteAllowed("AUDITOR", "/credit-memos/cli_0001")).toBe(true);
    expect(demoRouteAllowed("EMPLOYER", "/clients")).toBe(true);
    expect(demoRouteAllowed("ANALYST", "/queue")).toBe(true);
    expect(demoRouteAllowed("ANALYST", "/queue-secret")).toBe(false);
  });

  it("only enables synthetic write controls for the analyst", () => {
    expect(demoCanWrite("ANALYST")).toBe(true);
    expect(demoCanWrite("ANALYST", true)).toBe(false);
    for (const persona of DEMO_PERSONA_KEYS.filter(
      (key) => key !== "ANALYST",
    )) {
      expect(demoCanWrite(persona)).toBe(false);
    }
  });

  it("rejects forged role changes inside the signed session", async () => {
    const secret = "t".repeat(32);
    const token = await signSession(
      { sid: "demo-session", name: "Reviewer", persona: "CLIENT", exp: 2000 },
      secret,
    );
    expect((await verifySession(token, secret, 1000))?.persona).toBe("CLIENT");
    const [, signature] = token.split(".");
    const forgedBody = btoa(
      JSON.stringify({
        sid: "demo-session",
        name: "Reviewer",
        persona: "ANALYST",
        exp: 2000,
      }),
    ).replace(/=+$/, "");
    expect(
      await verifySession(forgedBody + "." + signature, secret, 1000),
    ).toBeNull();
    expect(await verifySession(token, secret, 2000)).toBeNull();
  });
});
