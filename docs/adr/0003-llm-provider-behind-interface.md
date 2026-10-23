# 0003. OpenAI-compatible LLM client behind a small interface

- Status: accepted
- Date: 2026-10-23

## Context

The prototype runs on a free tier (Groq, open-weight model). A later move to
another provider must not ripple through the agent code. Provider-side strict
JSON schema support varies by model.

## Decision

- Use the `openai` TypeScript SDK against an OpenAI-compatible endpoint.
  `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` and `LLM_PROVIDER` come from env.
- Wrap the client in `lib/agent/llm.ts`; the runner depends only on that
  interface.
- Request JSON in the prompt and use JSON mode where supported. Zod plus the
  citation validator is the guarantee, not the provider.
- Store provider, model and `PROMPT_VERSION` on every explanation.

## Consequences

Switching provider is a config change plus a re-run of the eval. Data sent to
a third-party API is synthetic; real customer data would need a privacy and
data-residency review first.
