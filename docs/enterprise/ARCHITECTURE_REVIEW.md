# Architecture review

Review date: 2026-10-27. Baseline: `main` at `41bf8b1`.

## System map

```
Browser
  |  HTTPS, signed session cookie (cd_auth)
  v
proxy.ts ---- persona route gate, session check, action-aware redirect (PR #202)
  |
  v
Next.js 16 App Router (Node runtime, Partial Prerendering, cacheComponents)
  |-- app/**/page.tsx       read paths: lib/queries/* (as-of, client-scoped)
  |-- app/actions.ts        writes: decideAction, incidentAction, setModeAction, rerunAgentAction
  |-- app/login/actions.ts  sign-in, quick demo, sign-out
  |-- app/api/watch/run     cron (bearer secret) -> lib/watch/runner
  |-- */export/route.ts     Markdown exports with digests
  v
Domain logic (pure, tested)
  lib/checks (11 rules)   lib/watch (rules, policy, trends)   lib/credit (borrowing base, memo, facility*)
  lib/trust (decide, snapshot chain, replay)   lib/risk (ageing, collections)   lib/workflow* (case machine)
  lib/agent (runner, tools, validator, money tokenizer) --> OpenAI-compatible provider (Groq configured)
  v
Drizzle ORM --> Neon PostgreSQL 17 (hosted)  |  PGlite (local and CI only; refused in production)

* library only, not wired to a page or action
```

Integrations: the only live external call is the optional LLM provider. Xero, Akahu and bank sources are adapter contracts with synthetic fixtures (`lib/data/*`), not connected.

## Assessment

| Area | Assessment | Evidence |
| --- | --- | --- |
| Layering | Good. Pure domain functions in `lib/checks`, `lib/watch` and `lib/credit`; I/O in `lib/queries` and actions; UI in `app/` and `components/` | Module review; unit tests per rule |
| Money and dates | Good. Integer cents, basis points, NZ business dates, `DEMO_TODAY` in logic | `lib/credit/borrowing-base.ts`; BigInt oracle 20,000 cases |
| Transaction boundaries | Good after PR #198. Decision, snapshot and audit are written in one `SERIALIZABLE` transaction under a chain lock with bounded retry | `lib/trust/decide.ts`, real PostgreSQL verifier |
| Idempotency | Decisions keyed by full UUID (PR #198); watch runs idempotent by design; incidents serialised by advisory lock | Tests in `tests/trust`, `tests/watch` |
| Concurrency ceiling | All decisions serialise on one global chain lock. Fine for a pilot team, a bottleneck at scale | Design note in ADR 0018 (PR #198) |
| Rate limiting | Postgres-backed counters with advisory locks; no extra infrastructure | `lib/rate-limit.ts` |
| AI boundary | The validator is authoritative; the agent has read-only tools scoped by client and as-of date | `lib/agent/tools.ts`, `validator.ts`, PRs #208 and #206 |
| Rendering | PPR plus streaming; static shell must not carry per-user data (the nav fallback fixed in PR #205 was the one leak of persona-shaped content) | PR #205 |
| Observability | JSON `console.log` events for watch runs and agent outcomes; no metrics, tracing or alerting | `app/api/watch/run/route.ts`, `lib/agent/runner.ts` |
| Configuration | Thresholds in config with comments; secrets in environment; production refuses PGlite | `lib/checks/config.ts`, `lib/db/backend.ts` |
| CI/CD | `verify` (typecheck, lint, format, tests, build, bundle scan, eval) and `visual-review` (production build plus browser smoke) on every PR; Vercel deploys `main` | `.github/workflows/*` |

## Technical debt and orphaned code

Production code with no production caller (tests only), found by an import scan:

| Module | Purpose | Recommendation |
| --- | --- | --- |
| `lib/workflow/case-store.ts`, `case-machine.ts` | Durable maker-checker case workflow | Wire into the queue as part of #105; this is the main missing control |
| `lib/credit/facility.ts` | Revolving and term principal models | Keep, behind #108 |
| `lib/funding/simulation.ts` | Drawdown simulation | Keep, behind #107; never connect to money movement without approval |
| `lib/data/xero.ts`, `akahu.ts`, `provider-contract.ts`, `sync-retry.ts`, `ingest-store.ts`, `synthetic.ts` | Ingestion adapters and retry leases | Keep, behind #100 and #106 |

None is reachable or advertised as live, so nothing is removed. Removing them would discard tested foundations that open epics depend on.

Other debt:

- The monetary tokenizer (`lib/agent/money.ts` in PR #208) is regex-based. Six review rounds kept finding edge cases. A grammar-based tokenizer, or a stricter output contract (amounts only as structured fields that cite cents), would be easier to prove. Recommended follow-up.
- Seven existing ESLint warnings.
- `scripts/review-ui-smoke.mjs` (928 lines) is a single long script; split by journey as it grows.

## Recommended decisions (ADR candidates)

1. **Structured amounts in agent output.** Require amounts as `{cents, evidenceId}` fields and forbid free-text currency in prose. This removes most tokenizer risk.
2. **Identity provider.** Neon Auth versus company SSO (#109). It blocks tenant grants and revocation.
3. **Decision lock partitioning.** Per-client chain or per-invoice lock if decision volume grows.
4. **Observability baseline.** Vercel log drains with structured fields and alerts on agent failure rate, watch-run failure and 5xx rate.
