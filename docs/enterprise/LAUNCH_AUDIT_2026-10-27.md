# Launch audit

Audit date: 2026-10-27. Baseline: `main` at `db68f02` (after OIDC identity, PR #219).
Scope: the whole repository and a local production build, from product, security,
AI reliability, data integrity, performance, UX, accessibility, operations and
code-quality perspectives. This audit supersedes nothing in
[ENTERPRISE_AUDIT.md](ENTERPRISE_AUDIT.md); it re-verifies its claims against the
current code and adds new findings.

## 1. Verdict

There are two different launches, and they have different bars.

| Launch target | Verdict | What blocks it |
| --- | --- | --- |
| **A. Public synthetic demo** (portfolio piece, one-click accounts) | **Not yet.** About one to two weeks of focused work | L1 to L8 below |
| **B. Real borrower or lender data** | **No.** Multi-month programme | Everything in A, plus R1 to R10 |

The domain core (checks, watch rules, money in cents, as-of semantics, serializable
decision transaction, OIDC flow) is well built and well tested. The problems are
at the edges: the AI guarantee the product advertises is not fully true today,
the integrity chain is weaker than described, a public visitor can degrade the
demo for everyone, and several launch basics (error pages, 404 behaviour,
noindex, scheduled jobs, docs accuracy) are missing.

**Rewrite or refactor?** Refactor. The architecture is sound for this product
and a rewrite would discard roughly 600 passing tests and verified financial
logic. Section 6 lists the targeted refactors that are worth doing.

## 2. Method and evidence

| Step | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass with 7 warnings (unused vars and imports) |
| `npm run format:check` | Pass |
| `vitest run --coverage` | 608 of 609 pass. One timeout at the 5 s default under load (`tests/data/client-source-reconciliation.test.ts`); passes in isolation. Suite takes 211 s |
| `npm audit` | 0 vulnerabilities |
| `npm run eval` | Gate passes |
| `npm run build` | Pass, 35 routes, all PPR |
| Validator probe | Hand-written cases against `validateOutput` (section 3, A1) |
| Browser pass | Production build on local PGlite, Playwright plus axe-core on 25 routes, desktop 1440 px and mobile 360 px |
| GitHub | PR #208 (validator money fix) is **open and unmerged** |
| Live site | Not reachable from the audit environment; headers checked on the local production build instead |

## 3. Findings

Severity: **P0** blocks the target launch, **P1** serious, **P2** important, **P3** minor.
Column "A" marks items that block the public demo launch; "B" items that block real data.

### 3.1 AI reliability

| # | Finding | Sev | A | B | Evidence | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | **The citation validator passes ungrounded amounts.** The tokenizer only recognises a currency marker *before* the number. Verified passing with evidence of $1.00: `"The balance is 999,999.00 NZD"`, `"The debtor owes 45000 dollars"`. PR #208 fixes the NZD-suffix case but is unmerged, and `SECURITY_REVIEW.md` lists it as fixed | P0 | x | x | `lib/agent/validator.ts:16-19`; probe | Stop validating prose. Make amounts structured: the model emits `{cents, evidenceId, field}` placeholders and the server renders the text. Then forbid any digit sequence in free text that is not a placeholder. This removes the regex tokenizer as a trust boundary |
| A2 | Percentages, day counts and non-ISO dates are not validated. Verified passing: `"Concentration is 97% of the book"`, `"Overdue by 400 days"`, `"Issued on 1 October 2025"` | P1 | x | x | probe | Same structured-facts approach for `bps`, `days` and dates; reject any unplaceheld number |
| A3 | The forbidden-wording guard is a short phrase list. `"It should be funded today"` passes | P2 | | x | `validator.ts:27-28` | Drop it as a control (the `recommendation` enum already carries intent) or replace with a classifier check plus UI framing; do not advertise it |
| A4 | **Published agent metrics are for an old prompt.** `eval/report.json` reports prompt `2026-10-23.4`; the running prompt is `2026-10-27.1` (adds the injection rule). The current prompt has zero evaluated runs | P1 | x | x | `eval/report.json`, `lib/agent/prompts/index.ts:2` | Re-run precompute on the current prompt, or show "not yet evaluated" for the current version on the Evaluation tab |
| A5 | Evaluation is small and provider-capped: 42 headline runs; across all 68 runs, 38% errored, mostly on the free-tier daily token cap | P2 | | x | `eval/report.json` `allRuns.errorRate` | Paid tier or self-hosted model for the demo; 200+ runs per prompt version; track per-check pass rates |
| A6 | `recommendation` is unconstrained by severity: a model can recommend APPROVE on a HIGH finding | P2 | | x | `lib/agent/schema.ts` | Validator rule: APPROVE is invalid when any HIGH finding is open; surface as REQUEST_INFO |
| A7 | Re-run executes the full agent loop (up to 30 s) inside a server action | P3 | | x | `app/actions.ts` `rerunAgentAction` | Enqueue a job; poll or stream status |

### 3.2 Data integrity and audit

| # | Finding | Sev | A | B | Evidence | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | **The "hash chain" does not chain.** `sha256 = SHA256(canonicalJson)`; `prevSha256` is stored beside the row but is not inside the hashed content. Rewriting snapshot N (new JSON and hash) and the `prev_sha256` column of N+1 leaves every check green, because N+1's own hash does not cover its link | P1 | | x | `lib/trust/snapshot.ts` `hashSnapshot`, `verifySnapshot`; `decide.ts:150-158` | Hash `prevSha256 \|\| canonicalJson`; add a whole-chain verifier; add `UNIQUE(prev_sha256)` to make forks impossible; anchor the head externally (daily signed digest to object storage with object lock) |
| D2 | The `decisions` table is not append-only. Triggers cover snapshots, audit events, runs, explanations and incident events, but not decisions, which the UI reads | P1 | | x | `lib/db/migrations/0001_append_only_triggers.sql` | Add the trigger; also block `TRUNCATE` with a statement trigger; run the app under a role that cannot `ALTER TABLE` or disable triggers |
| D3 | `chainHead` sorts `decision_snapshots` by `created_at` with no index while holding the global chain lock inside a SERIALIZABLE transaction. Cost grows linearly with history on every decision | P2 | | x | `snapshot.ts:82-92`; no index in migrations | Index `(created_at, decision_id)`, or keep the head in a one-row table updated in the same transaction |
| D4 | One global advisory lock serialises all decisions (documented). Fine for a pilot, a ceiling for a team | P3 | | x | `decide.ts` `CHAIN_LOCK` | Per-client chains when volume requires |
| D5 | Data exports (portfolio pack, memo) are not audit-logged | P2 | | x | `app/portfolio/export/route.ts`, `app/credit-memos/[id]/export/route.ts` | Write an `EXPORT` audit event with scope and digest |
| D6 | `rate_limit_events` is never pruned; every login, quick-demo, write and re-run inserts rows forever | P2 | x | x | `lib/rate-limit.ts`; no delete anywhere | Delete rows older than the longest window from the daily job, or move to a fixed-window counter table with upsert |

### 3.3 Security and abuse (public demo)

| # | Finding | Sev | A | B | Evidence | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | **Anonymous visitors write permanent records into the shared database.** One-click analyst sessions record decisions and incident notes into append-only tables. Free-text reasons render in the audit log for every visitor and cannot be deleted. Public decisions also land in the live (non-simulated) Trust Panel cohort, since the only cohort split is `simulated` | P0 | x | | `app/login/actions.ts` `quickDemoAction` (`publicWrites: true`); `app/actions.ts` | Per-visitor sandbox: writes from public sessions go to a session-scoped overlay that expires with the session, or a scheduled reset that restores the seeded database. At minimum exclude public sessions from Trust Panel metrics and do not render public free text to other visitors |
| S2 | **Global rate-limit buckets let a few clients deny service to everyone.** `write:global` 2,000/day vs `write:ip` 120/h: one address exhausts it in about 17 h, 17 addresses in 1 h. `rerun:global` 200/day vs 10/h per address: one address in 20 h. `login:global` 200 per 15 min: 20 addresses lock out sign-in, including people who hold the password. Per-address limits stop one address alone, so the cost to an attacker is a handful of addresses | P1 | x | | `app/actions.ts:52-58,253-257`; `app/login/actions.ts:56-63` | Keep per-session and per-address limits; replace hard global caps with a cost budget alarm, or per-/24 limits plus a CAPTCHA/Turnstile challenge after N failures. Never let the global login cap lock out password holders |
| S3 | Demo sessions are stateless and cannot be revoked (documented). OIDC sessions are revocable | P2 | | | `lib/auth.ts` | Acceptable for synthetic demo; rotate `SESSION_SECRET` to revoke all |
| S4 | CSP allows `script-src 'unsafe-inline'` (PPR constraint, documented) | P3 | | x | `lib/security/headers.ts` | Hash-based CSP for the theme script; revisit when nonces work with PPR |
| S5 | `X-Powered-By: Next.js` is sent; HSTS relies on the host | P3 | x | | local `curl -I` | `poweredByHeader: false`; add HSTS in `securityHeaders` for non-dev |
| S6 | Cookies are not `__Host-` prefixed (`cd_session`, `cd_auth`) | P3 | | x | `lib/identity/tokens.ts`, `lib/auth.ts` | Rename to `__Host-cd_session` (Secure, Path=/, no Domain) |
| S7 | Rate-limit address trusts `x-real-ip` off Vercel (documented) | P3 | | | `lib/request.ts` | Keep Vercel or a trusted proxy |

### 3.4 Identity and authorization (real data)

| # | Finding | Sev | A | B | Evidence | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | Maker-checker is library-only; one ANALYST approval is final | P0 | | x | `lib/workflow/case-store.ts` has no production caller | Wire the case machine into the decision path: APPROVE above a threshold or with HIGH findings creates a pending case a different CHECKER must sign |
| R2 | **No segregation of duties for administrators.** An ADMIN can grant themselves ANALYST and CHECKER and every client; access changes need no second approver | P1 | | x | `lib/identity/admin.ts` `updateAccess` only blocks removing one's own ADMIN | Forbid ADMIN combined with ANALYST/CHECKER; require a second admin for role grants; alert on self-changes |
| R3 | Authorization lives in proxy path regexes plus per-action checks. Portfolio-wide pages are all-or-nothing; read models do not filter by grant | P1 | | x | `proxy.ts` `identityProxy`, `lib/identity/policy.ts` `isPortfolioWidePath` | Push grants into the query layer: every read model takes an `AccessScope` and filters by `client_id IN grants`. Keep the proxy as defence in depth |
| R4 | Approving a HIGH-risk invoice needs no reason (reason is optional for APPROVE) | P1 | x | x | `lib/trust/decide.ts:24-33`; invoice panel screenshot | Require an override reason (and, for B, a checker) when approving with open HIGH findings |
| R5 | Proxy cost in OIDC mode: each request runs a 3-query session transaction, a full `clients` scan for portfolio paths, and pages resolve the session again. Roughly 7 to 9 database round trips before any page data | P2 | | x | `proxy.ts`, `lib/identity/current.ts` | Resolve once per request (React `cache`), store a short-lived signed access claim, cache the client count |
| R6 | No tenant model beyond one `CREDIT_DESK_TENANT_ID` per deployment | P2 | | x | `lib/identity/config.ts` | Fine for single-lender deployment; decide before multi-tenant SaaS |

### 3.5 Product and workflow

| # | Finding | Sev | A | B | Evidence | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | No bulk action: a 32-invoice batch with 28 clear invoices needs 32 individual decisions | P1 | | x | invoice screenshot | "Approve all clear invoices" with a single snapshot per invoice and one confirmation |
| P2 | The CHECKER perspective has no workflow (read-only queue) | P2 | x | x | `lib/demo-personas.ts` `demoCanWrite` | Hide it until R1 ships, or ship a minimal sign-off |
| P3 | `DEMO_TODAY` is frozen at 2026-10-20 and the cron job always re-runs that date, so the daily watch run is a no-op after the first call. The cron is also not scheduled (`vercel.json` has no `crons`) | P2 | x | x | `lib/demo.ts`, `app/api/watch/run/route.ts`, `vercel.json` | For the demo, label the frozen date and remove the cron claim. For B, a business-date service (`Pacific/Auckland`) and a scheduled run |
| P4 | Synthetic numbers undermine credibility: funds in use $30,774.69 across four facilities against $5.97 M headroom, while single batches are $262k to $277k | P3 | x | | overview screenshot | Tune the generator so the funded book is a plausible share of limits |

### 3.6 UX, accessibility and SEO

| # | Finding | Sev | A | B | Evidence | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| U1 | No `error.tsx`, `global-error.tsx` or `not-found.tsx`. A server error shows the framework default; a failing streamed section breaks the page | P1 | x | x | `app/` listing | Branded error and not-found pages; per-section error boundaries around Suspense |
| U2 | **Unknown URLs never 404 for signed-in users.** `/does-not-exist` redirects to the persona home (`/queue`) because the proxy treats unknown paths as disallowed | P2 | x | x | browser pass | Only redirect for known-but-forbidden prefixes; let unknown paths reach `not-found` |
| U3 | `notFound()` inside streamed PPR content returns **HTTP 200** (`/clients/nope`) | P2 | x | x | browser pass | Validate ids before the Suspense boundary, or return 404 from the proxy for unknown record ids |
| U4 | Mobile shell: header, sign-in card and a horizontally scrolling nav use about 45% of a 360x740 viewport before content; most nav items are off-screen | P2 | x | | mobile screenshot | Collapsible top bar with a menu sheet; move identity into the menu |
| U5 | Page titles: client, memo and borrowing-base detail pages are just "Credit Desk"; several titles duplicate the suffix ("Client activity · Credit Desk \| Credit Desk") | P3 | x | | browser pass | `generateMetadata` with the record name; drop the manual suffix |
| U6 | axe: login page has one serious colour-contrast violation; invoice view has one `region` violation. All other 23 routes clean | P2 | x | | axe-core | Fix the two; add axe to the smoke workflow as a gate |
| U7 | Login page hard-codes `bg-white` and slate colours, so it ignores the dark theme | P3 | x | | `app/login/page.tsx` | Use theme tokens |
| U8 | No `robots` metadata. A public demo with one-click accounts should not be indexed | P2 | x | | `app/layout.tsx` | `robots: { index: false }` plus `app/robots.ts` |
| U9 | Decision save confirmation is lost when the form remounts (documented) | P3 | x | | ENTERPRISE_AUDIT section 6 | Toast or persistent status outside the form |
| U10 | Heavy HTML: borrowing-base worksheet 295 KB, source health 250 KB, audit 214 KB | P3 | | x | browser pass | Paginate or virtualise; collapse detail rows |

### 3.7 Performance and scalability

| # | Finding | Sev | A | B | Evidence | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | `listBatches` loads every invoice and every finding, then filters per batch in JavaScript: O(batches x invoices) time and full-table memory on each request | P2 | | x | `lib/queries/book.ts` `listBatches` | One SQL aggregate grouped by batch |
| F2 | Same pattern in other read models (whole-book scans per request) | P2 | | x | `lib/queries/*` | Push aggregation into SQL; add a load test with 100k invoices |
| F3 | No agreed performance targets or hosted load test. Local production build: about 0.7 to 1.4 s per page on PGlite (not representative of Neon) | P2 | x | x | browser pass | Set p95 targets (for example 500 ms server time); run k6 against a Neon preview |
| F4 | Neon Pool is created with defaults (no `max`, no idle timeout) and the Neon client is cast to the PGlite type | P3 | | x | `lib/db/client.ts:55-60` | Configure pool limits; type `Db` as the shared `PgDatabase` interface |

### 3.8 Operations and delivery

| # | Finding | Sev | A | B | Evidence | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| O1 | No error tracking, alerts or SLOs; only JSON `console.log` | P1 | x | x | `lib/agent/runner.ts`, cron route | Error tracking (Sentry or equivalent), log drain, alerts on 5xx rate, agent failure rate and job failure |
| O2 | Free tiers in the critical path: Groq free tier (daily token cap caused 38% run errors) and a Neon free project with unverified restore | P1 | x | x | `eval/report.json`; SECURITY_REVIEW | Paid tiers for the public launch; restore drill before B |
| O3 | CI tests run on PGlite only. Real PostgreSQL behaviour (serializable retries, advisory locks over WebSocket) is verified by a manual script | P2 | | x | `.github/workflows/ci.yml` | Add a Postgres service job running integration tests and `verify-review-concurrency` |
| O4 | Flaky test: 5 s default timeout with per-test PGlite migrations; suite takes 211 s | P3 | x | | test run | Share one migrated template database per worker; raise timeout for DB tests |
| O5 | 7 ESLint warnings | P3 | x | | lint run | Remove unused imports; prefix-ignore rule for intentional `_args` |

### 3.9 Documentation and claims

| # | Finding | Sev | A | B | Evidence | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | **The product claims more than it does.** The About page says the validator rejects any amount not in the cited records (A1 disproves it). The About page and README describe a SHA-256 chain (D1 weakens it). `SECURITY_REVIEW.md` marks PR #208 "Fixed" while it is open | P0 | x | | `app/about/page.tsx`, README, `docs/enterprise/SECURITY_REVIEW.md` | Fix A1 and D1, or reword the claims until they are true |
| C2 | README "Limitations" still says sign-in is only a shared password; OIDC mode exists | P3 | x | | README | Update |
| C3 | The repository carries many internal process documents (`docs/review`, `docs/programme`, `docs/enterprise`). For a public portfolio repo this buries the README | P3 | x | | `docs/` | Keep ADRs, deploy and runbooks; archive process notes |

## 4. Launch checklist

### A. Public synthetic demo (must do)

1. A1, A2, C1: structured amounts or merge PR #208 plus number checks; make every public claim true.
2. S1: sandbox or reset public writes; exclude public sessions from Trust Panel metrics.
3. S2: remove the hard global caps that let a few addresses lock everyone out.
4. U1, U2, U3: error and not-found pages, real 404s.
5. U8, S5: `noindex`, drop `X-Powered-By`.
6. A4: evaluate the current prompt or label it unevaluated.
7. O1, O2: error tracking and alerting; paid LLM tier (or disable re-run and show precomputed output only).
8. P3: label the frozen business date; remove the unscheduled cron claim.

Should do: R4, P2, U4, U5, U6, U7, D6, O4, O5, P4.

### B. Real data (in addition)

R1 maker-checker, R2 segregation of duties, R3 data-layer authorization, D1 to D3
integrity chain, D5 export audit, P1 bulk actions, F1 to F3 scalability with a load
test, O3 Postgres CI, restore drill, privacy impact assessment, retention policy,
approved credit-policy values, real Xero and Akahu integrations under the relevant
accreditation, and a provider and data-residency review before customer data
reaches a model.

## 5. What is good and should be kept

- Money as integer cents and basis points, per-invoice rounding, overflow guards; independently verified borrowing base.
- As-of semantics for checks, watch rules and agent tools (no look-ahead).
- Decision, snapshot and audit written in one SERIALIZABLE transaction with review-version staleness checks and idempotency keys.
- OIDC flow: PKCE, state, nonce, MFA via `amr`/`acr`, provisioned users only, revocable hashed sessions, tenant and issuer realm checks.
- Server-side persona route gate, Zod at every boundary, `server-only` on secret readers, client bundle scan in CI, security headers.
- Shadow mode, exposure tracking and agreement statistics: a genuinely good idea for introducing AI into credit decisions.

## 6. Recommended refactors

| Refactor | Why | Effort |
| --- | --- | --- |
| Structured agent facts: model emits fact placeholders bound to evidence fields; server renders text | Turns the validator from a regex heuristic into an exact check; closes A1 to A3 permanently | 3 to 5 days |
| Integrity v2: hash includes previous hash, decisions append-only, whole-chain verifier, external anchor | Makes the replay and integrity claims true (D1 to D3) | 2 to 3 days plus a migration |
| Access scope in the query layer | Every read model filtered by grants; enables partial-grant portfolio views (R3) | 1 to 2 weeks |
| Public demo sandbox | Visitors cannot affect each other; enables generous write limits (S1, S2) | 2 to 4 days |
| SQL read models | Removes whole-table scans (F1, F2) | 3 to 5 days |
| Background jobs for agent runs and watch runs | No 30 s server actions; retries and observability (A7, P3) | 2 to 3 days |
