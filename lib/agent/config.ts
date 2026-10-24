// Agent limits and provider settings (SPEC 8). Values here are read by the
// runner, the LLM client and the precompute script.

export const AGENT_LIMITS = {
  // Maximum tool calls per run, across both attempts.
  maxToolCalls: 6,
  // Cap on completion tokens per model call.
  maxCompletionTokens: 1500,
  // Total wall time per run, covering every attempt, retry and backoff.
  runBudgetMs: 30_000,
  // Client-side budget kept under Groq's 8,000 tokens per minute (verified
  // from the x-ratelimit-limit-tokens response header on 2026-10-23).
  tokensPerMinute: 7_800,
  // Typical completion size used when reserving budget for a call; actual
  // usage is recorded after each call.
  expectedCompletionTokens: 400,
  // Headroom the precompute waits for before starting a run, so a whole run
  // (several calls, each resending the conversation) fits in one minute.
  tokensPerRun: 7_800,
  // Retries for 429 and transient 5xx responses within the run budget.
  maxRateLimitRetries: 3,
} as const;

export interface ProviderConfig {
  provider: string;
  baseURL: string;
  apiKey: string;
  model: string;
}

/** Reads provider settings from the environment. Server and scripts only. */
export function providerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ProviderConfig {
  const missing = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"].filter(
    (k) => !env[k],
  );
  if (missing.length > 0) {
    throw new Error(`missing LLM settings: ${missing.join(", ")}`);
  }
  return {
    provider: env.LLM_PROVIDER || "openai-compatible",
    baseURL: env.LLM_BASE_URL!,
    apiKey: env.LLM_API_KEY!,
    model: env.LLM_MODEL!,
  };
}
