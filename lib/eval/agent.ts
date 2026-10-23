// Agent quality metrics from stored runs (SPEC 9.4). Computed from the
// eval/agent-runs.json export, so CI never calls the model.

export interface StoredRun {
  id: string;
  status: "PASSED" | "FAILED" | "ERROR";
  attempts: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export interface StoredExplanation {
  agentRunId: string;
  validationStatus: "PASSED" | "FAILED" | "ERROR";
  validationErrors: string[];
}

export interface AgentMetrics {
  runs: number;
  /** Runs that ended with an explanation passing every validator rule. */
  passRate: number | null;
  /** Final outputs that parsed against the schema. */
  schemaPassRate: number | null;
  /** Final outputs with no citation errors (unknown or foreign ids). */
  citationValidity: number | null;
  /** Final outputs with no amount or date mismatch against cited records. */
  amountFaithfulness: number | null;
  /** Runs that needed the second attempt. */
  retryRate: number | null;
  errorRate: number | null;
  avgTokens: number | null;
  avgLatencyMs: number | null;
}

const rate = (n: number, d: number) => (d === 0 ? null : n / d);

export function agentMetrics(
  runs: StoredRun[],
  explanations: StoredExplanation[],
): AgentMetrics {
  const byRun = new Map(explanations.map((e) => [e.agentRunId, e]));
  const finished = runs.filter((r) => r.status !== "ERROR");
  let schemaOk = 0;
  let citationsOk = 0;
  let amountsOk = 0;
  for (const r of finished) {
    const e = byRun.get(r.id);
    const errors = e?.validationErrors ?? [];
    // No explanation row means the final output did not parse.
    if (
      !e ||
      errors.some(
        (x) =>
          x.startsWith("schema:") || x.startsWith("output is not valid JSON"),
      )
    )
      continue;
    schemaOk++;
    if (!errors.some((x) => /not returned by a tool/.test(x))) citationsOk++;
    if (!errors.some((x) => /which is not in/.test(x))) amountsOk++;
  }
  return {
    runs: runs.length,
    passRate: rate(
      runs.filter((r) => r.status === "PASSED").length,
      runs.length,
    ),
    schemaPassRate: rate(schemaOk, finished.length),
    citationValidity: rate(citationsOk, schemaOk),
    amountFaithfulness: rate(amountsOk, schemaOk),
    retryRate: rate(runs.filter((r) => r.attempts > 1).length, runs.length),
    errorRate: rate(
      runs.filter((r) => r.status === "ERROR").length,
      runs.length,
    ),
    avgTokens: runs.length
      ? Math.round(
          runs.reduce((s, r) => s + r.tokensIn + r.tokensOut, 0) / runs.length,
        )
      : null,
    avgLatencyMs: runs.length
      ? Math.round(runs.reduce((s, r) => s + r.latencyMs, 0) / runs.length)
      : null,
  };
}
