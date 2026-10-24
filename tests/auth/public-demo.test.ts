import { describe, expect, it } from "vitest";
import { DEMO_PERSONA_KEYS } from "@/lib/demo-personas";
import {
  PUBLIC_DEMO_ACCOUNT_EMAILS,
  PUBLIC_DEMO_TTL_SECONDS,
  publicDemoEnabled,
} from "@/lib/public-demo";

describe("opt-in public one-click demo", () => {
  it("is disabled unless BOTH opt-in switches are present", () => {
    expect(publicDemoEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(publicDemoEnabled({ PUBLIC_DEMO_ENABLED: "1" } as NodeJS.ProcessEnv)).toBe(false);
    expect(publicDemoEnabled({ CREDIT_DESK_DATA_CLASSIFICATION: "SYNTHETIC" } as NodeJS.ProcessEnv)).toBe(false);
    expect(publicDemoEnabled({ PUBLIC_DEMO_ENABLED: "yes", CREDIT_DESK_DATA_CLASSIFICATION: "SYNTHETIC" } as NodeJS.ProcessEnv)).toBe(false);
    expect(publicDemoEnabled({ PUBLIC_DEMO_ENABLED: "1", CREDIT_DESK_DATA_CLASSIFICATION: "synthetic" } as NodeJS.ProcessEnv)).toBe(false);
    expect(publicDemoEnabled({ PUBLIC_DEMO_ENABLED: "1", CREDIT_DESK_DATA_CLASSIFICATION: "SYNTHETIC" } as NodeJS.ProcessEnv)).toBe(true);
  });
  it("defines a distinct fictional contact for each existing role", () => {
    expect(Object.keys(PUBLIC_DEMO_ACCOUNT_EMAILS)).toEqual(DEMO_PERSONA_KEYS);
    expect(new Set(Object.values(PUBLIC_DEMO_ACCOUNT_EMAILS)).size).toBe(5);
    expect(Object.values(PUBLIC_DEMO_ACCOUNT_EMAILS).every((email) =>
      email.endsWith(".example"),
    )).toBe(true);
    expect(PUBLIC_DEMO_TTL_SECONDS).toBe(3600);
  });
});
