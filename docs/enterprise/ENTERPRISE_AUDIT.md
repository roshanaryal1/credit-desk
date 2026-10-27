# Enterprise audit

Audit date: 2026-10-27. Baseline: `main` at `41bf8b1` (deployed at https://creditdesk.roshanaryal.com). Tracking issue: #180.

Companion documents:

- [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md): every feature with status and evidence
- [E2E_TEST_REPORT.md](E2E_TEST_REPORT.md): what was executed and the results
- [SECURITY_REVIEW.md](SECURITY_REVIEW.md)
- [ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md)
- [COMPETITOR_BENCHMARK.md](COMPETITOR_BENCHMARK.md)
- [ENTERPRISE_ROADMAP.md](ENTERPRISE_ROADMAP.md)
- [RELEASE_READINESS.md](RELEASE_READINESS.md)

## 1. Product as found

Credit Desk is a synthetic-data prototype of an invoice-finance operations workbench. It covers deterministic invoice checks, borrowing-base availability, portfolio watch rules, a decision record with an SHA-256 snapshot chain and replay, and an AI explainer whose output is accepted only when a citation validator grounds every amount, date and ID. Five self-selected demo personas share one password. There is no real identity, tenant model, ingestion or money movement. `SPEC.md` and the UI state this.

## 2. Method

1. Repository discovery: routes, actions, route handlers and library modules, with an import scan for orphaned code. Open PRs, issues and in-flight branches were reviewed against `project-state` and GitHub.
2. Baseline gates on each branch: typecheck, lint, format, tests, build, bundle scan, eval.
3. An adversarial authorization and session probe in a real browser against a disposable production build (46 checks).
4. Persona journeys, responsive layout runs (Chromium and WebKit), navigation and prefetch inspection.
5. A financial oracle: an independent BigInt implementation over 20,000 randomised borrowing-base cases.
6. AI path review: prompt construction, tool data, validator, retry protocol; scripted-model injection tests.
7. Live, read-only response header check on the hosted site.
8. Primary-source competitor research.
9. Independent Codex review of every change, repeated after each fix until no actionable findings remained, or until the remaining items were documented.

## 3. Findings

Severity: P0 critical, P1 serious, P2 important, P3 minor.

| # | Finding | Severity | Root cause (verified) | Reproduction | Issue | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | No real identity, tenant isolation or session revocation | P0 for real data | Demo gate by design (`lib/auth.ts`, `lib/session.ts`) | Probe S2: replay a token after sign-out, get 200 | #109 | Needs IdP decision |
| F2 | Approvals could be recorded after reviewed financial facts changed; truncated idempotency entropy | P1 | Review version omitted cash and evidence facts; non-serializable read | Real PostgreSQL verifier (six checks) | #182, #185 | PR #198 |
| F3 | Unsupported monetary text could pass the AI citation validator | P1 | Prefix-only tokenizer, then regex edge cases (13 found over six review rounds) | `tests/agent/money.test.ts` cases, e.g. `Balance=999999.00 NZD.` with $1 evidence | #186 | PR for #186 |
| F4 | Raw provider failures in logs and outcomes | P1 | Exception text propagated | Unit tests in PR | #188 | PR #195 |
| F5 | Missing security headers on the hosted site | P2 | No `headers()` config | `curl -sD- https://creditdesk.roshanaryal.com/login` shows only HSTS | #197 | PR #200 |
| F6 | Expired or wrong-persona form submit shows an error screen and loses input | P2 | Proxy 307 to HTML for fetch-based server actions | E2E report section 2 | #199 | PR #202 |
| F7 | No prompt-injection defence or tests at the prompt layer | P2 | Prompt lacked an untrusted-data rule | `tests/agent/prompt-injection.test.ts` | #204 | PR #206 |
| F8 | Impossible Watch date crashed a streamed page | P2 | Unvalidated date parameter | Earlier session reproduction | #192 | PR #196 |
| F9 | Layout overflow on tablet and phone; clipped keyboard focus | P2 | Missing `min-w-0`, unscrollable tables | Responsive script | #189-#191, #193 | PR #201 |
| F10 | Navigation fallback shows analyst links to every persona | P3 | Fallback hard-coded ANALYST | E2E report section 3 | #203 | PR #205 |
| F11 | Maker-checker workflow is library-only | P0 for production lending | Not wired to UI or actions | `lib/workflow/case-store.ts` has no production importer | #105 | Roadmap |
| F12 | Ingestion connectors are fixtures only | P1 for production | No provider apps or credentials | `lib/data/xero.ts` has no production importer | #100, #106 | Blocked |
| F13 | No administration role, policy administration or approved policy values | P1 for production | Not built; values illustrative | Inventory roles table | #101, #102, #109 | Roadmap |
| F14 | No alerting, restore drill or retention policy | P1 for production | Not built | Security review | n/a (roadmap) | Roadmap |
| F15 | Rate-limit address taken from `x-real-ip` off Vercel | P3 | Trust assumption documented in code | Probe uses this header to select buckets locally | n/a | Deployment note |

The tracking epic #180 lists all issues. Previous sessions closed #183, #187 (PR #194) and withdrew #184 as a false positive.

## 4. Financial logic

- Integer cents and basis points throughout; per-invoice floor rounding then sum; safe-integer checks with overflow errors rather than wrong numbers.
- The borrowing base was verified by an independent oracle (20,000 cases, 0 mismatches) and by existing unit tests.
- Decision integrity: atomic decision, snapshot and audit under `SERIALIZABLE` isolation with retry (PR #198). Real PostgreSQL concurrency verified.
- No look-ahead: tools and checks read records effective on or before the as-of date (existing tests).
- **Not approved:** policy values such as advance rate, concentration share and reserves. They are illustrative defaults in config and need a credit policy owner.

## 5. AI reliability

- Model: an OpenAI-compatible provider configured by environment (`LLM_BASE_URL`, `LLM_MODEL`); limits of 6 tool calls, 1,500 completion tokens and a 30 s run budget, with one validation retry.
- The validator is authoritative: forbidden decision language, citation existence, and grounded amounts, dates and IDs. Stored explanations are revalidated before display.
- The agent is read-only; shadow mode hides output until the analyst decides.
- Gaps: free-text currency in prose is hard to validate perfectly (recommend structured amounts); recommendation is not constrained by severity (owner decision); live-model injection resistance is untested.

## 6. UX

- Persona journeys render without overflow at 320 to 1920 px after PR #201; keyboard focus stays visible.
- Decision form: after a successful save the form remounts and the inline "Decision saved." status is not visible. The "Current decision" block updates, which is the only confirmation. Minor, noted for #113.
- The CHECKER persona exists without any checker workflow; consider hiding it until #105.

## 7. Conclusion

For its stated purpose, a synthetic demonstration of an invoice-finance workbench, the core flows work and are evidenced. It is **not enterprise-ready** for real lending: identity, tenant isolation, maker-checker, real ingestion, approved policy and operations controls are missing, and several need owner decisions or external credentials. See [RELEASE_READINESS.md](RELEASE_READINESS.md).
