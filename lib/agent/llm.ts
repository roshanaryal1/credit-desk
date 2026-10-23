import OpenAI from "openai";
import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from "openai/resources/chat/completions";

import { AGENT_LIMITS, type ProviderConfig } from "./config";

// A small provider-agnostic interface over OpenAI-compatible chat APIs
// (ADR 0003). The runner depends only on LlmClient.

export interface LlmRequest {
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  toolChoice?: ChatCompletionToolChoiceOption;
  /** Ask for a JSON object where the provider supports it. */
  json?: boolean;
  /** Absolute epoch-ms deadline for this call including retries. */
  deadline: number;
}

export interface LlmResult {
  message: ChatCompletionMessage;
  tokensIn: number;
  tokensOut: number;
}

export interface LlmClient {
  readonly provider: string;
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResult>;
}

export class DeadlineExceeded extends Error {
  constructor() {
    super("agent run budget exceeded");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sliding one-minute token budget, shared by every call from this process. */
export class TokenBudget {
  private spent: { at: number; tokens: number }[] = [];

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Milliseconds to wait before `estimate` tokens fit in the window. */
  waitFor(estimate: number): number {
    const cutoff = this.now() - 60_000;
    this.spent = this.spent.filter((s) => s.at > cutoff);
    let used = this.spent.reduce((sum, s) => sum + s.tokens, 0);
    if (used + estimate <= this.perMinute) return 0;
    for (const s of this.spent) {
      used -= s.tokens;
      if (used + estimate <= this.perMinute) return s.at + 60_000 - this.now();
    }
    return 60_000;
  }

  record(tokens: number) {
    this.spent.push({ at: this.now(), tokens });
  }
}

/** Parses Retry-After (seconds or HTTP date) into milliseconds. */
export function retryAfterMs(
  header: string | null | undefined,
  now = Date.now(),
): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export class OpenAiCompatibleClient implements LlmClient {
  readonly provider: string;
  readonly model: string;
  private readonly client: OpenAI;

  constructor(
    config: ProviderConfig,
    readonly budget = new TokenBudget(AGENT_LIMITS.tokensPerMinute),
  ) {
    this.provider = config.provider;
    this.model = config.model;
    // Retries are handled here so they count against the run budget.
    this.client = new OpenAI({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      maxRetries: 0,
    });
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const estimate =
      estimateTokens(request) + AGENT_LIMITS.expectedCompletionTokens;
    for (let attempt = 0; ; attempt++) {
      // The local budget is advisory: if waiting would breach the deadline,
      // send anyway and let a real 429 (with retry-after) decide.
      const wait = this.budget.waitFor(estimate);
      if (wait > 0 && Date.now() + wait < request.deadline) await sleep(wait);
      try {
        const remaining = request.deadline - Date.now();
        if (remaining <= 0) throw new DeadlineExceeded();
        const data = await this.client.chat.completions.create(
          {
            model: this.model,
            messages: request.messages,
            max_completion_tokens: AGENT_LIMITS.maxCompletionTokens,
            ...(request.tools ? { tools: request.tools } : {}),
            ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}),
            ...(request.json
              ? { response_format: { type: "json_object" as const } }
              : {}),
          },
          { timeout: remaining },
        );
        const tokensIn = data.usage?.prompt_tokens ?? 0;
        const tokensOut = data.usage?.completion_tokens ?? 0;
        this.budget.record(tokensIn + tokensOut);
        const message = data.choices[0]?.message;
        if (!message) throw new Error("provider returned no choices");
        return { message, tokensIn, tokensOut };
      } catch (err) {
        if (err instanceof DeadlineExceeded) throw err;
        if (
          !(err instanceof OpenAI.APIError) ||
          attempt >= AGENT_LIMITS.maxRateLimitRetries
        )
          throw err;
        const status = err.status ?? 0;
        if (status !== 429 && status < 500) throw err;
        const backoff =
          retryAfterMs(err.headers?.get?.("retry-after")) ??
          Math.min(8_000, 1_000 * 2 ** attempt);
        if (Date.now() + backoff >= request.deadline)
          throw new DeadlineExceeded();
        await sleep(backoff);
      }
    }
  }
}

/** Rough token estimate (4 characters per token) for budgeting only. */
export function estimateTokens(
  request: Pick<LlmRequest, "messages" | "tools">,
): number {
  const chars =
    JSON.stringify(request.messages).length +
    JSON.stringify(request.tools ?? []).length;
  return Math.ceil(chars / 4);
}
