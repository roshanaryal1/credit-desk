import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("tooling smoke test", () => {
  it("resolves the @ path alias", () => {
    expect(typeof cn).toBe("function");
  });
});
