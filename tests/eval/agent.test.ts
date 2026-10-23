import { describe, expect, it } from "vitest";

import { agentMetrics } from "@/lib/eval/agent";

const run = (
  id: string,
  status: "PASSED" | "FAILED" | "ERROR",
  attempts = 1,
) => ({
  id,
  status,
  attempts,
  tokensIn: 1000,
  tokensOut: 200,
  latencyMs: 3000,
});

describe("agent metrics", () => {
  it("separates schema, citation and amount failures", () => {
    const m = agentMetrics(
      [
        run("a", "PASSED"),
        run("b", "FAILED", 2),
        run("c", "FAILED", 2),
        run("d", "ERROR"),
      ],
      [
        { agentRunId: "a", validationStatus: "PASSED", validationErrors: [] },
        {
          agentRunId: "b",
          validationStatus: "FAILED",
          validationErrors: [
            "claim 1 cites bnk_9, which was not returned by a tool in this run",
          ],
        },
        {
          agentRunId: "c",
          validationStatus: "FAILED",
          validationErrors: [
            "summary states $1.00, which is not in any cited record",
          ],
        },
      ],
    );
    expect(m).toMatchObject({
      runs: 4,
      passRate: 0.25,
      schemaPassRate: 1,
      citationValidity: 2 / 3,
      amountFaithfulness: 2 / 3,
      retryRate: 0.5,
      errorRate: 0.25,
      avgTokens: 1200,
    });
  });

  it("returns n/a (null) with no runs", () => {
    expect(agentMetrics([], []).passRate).toBeNull();
  });
});
