# Feature inventory

Audit date: 2026-10-27. Baseline: `main` at `41bf8b1`. Scope: every route in `app/`, every server action and route handler, and library modules with no production caller.

Status values:

- **Verified working**: exercised end to end against a production build in this audit or in recorded CI evidence, with persistence or output checked.
- **Partially working**: works, with a confirmed defect or a missing part.
- **Library only**: implemented and unit tested, but not reachable from any page, action or job.
- **Blocked**: needs credentials, an external provider or a business decision.

Evidence sources:

- A: `scripts/audit-authorization-probe.mjs` against a disposable local production build (46 checks).
- C: GitHub CI `visual-review` job (`scripts/review-ui-smoke.mjs`: 19 routes, 5 personas, behaviour checks).
- R: `scripts/review-responsive-layouts.mjs` (6 widths, Chromium and WebKit, on PR #201).
- U: Vitest suites (474 tests on `main`).
- O: independent BigInt oracle (20,000 randomised borrowing-base cases).

Details are in [E2E_TEST_REPORT.md](E2E_TEST_REPORT.md).

## Roles

| Role (demo persona) | Can read | Can write | Identity strength |
| --- | --- | --- | --- |
| Employer / lender | Whole synthetic workbench | Nothing | Self-selected after a shared password |
| Credit analyst | Workbench, queue, batches, watch, trust, audit | Synthetic decisions, incident notes, agent re-run, review mode | Self-selected after a shared password; public one-click analyst is read-only |
| Credit checker | Workbench except audit | Nothing; no sign-off authority exists | Self-selected |
| Client / borrower | Own fixed fictional client (`cli_0001`) only | Nothing | Self-selected |
| Auditor | Trust, audit, clients, memos, watch, portfolio, operations | Nothing | Self-selected |
| Administrator | **Missing.** No administration role, user management or policy administration exists | n/a | n/a |

Route limits are enforced in `proxy.ts` via `demoRouteAllowed`, and write limits in each server action via `canPerformDemoWrite`. Both were verified by probe A, including RSC and export requests and persistence-checked write attempts. These are synthetic demonstration controls, not enterprise identity (#109).

## Features

| # | Feature | Route or module | Intended behaviour | Actual behaviour (evidence) | Tests | Issue / PR | Status | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Sign in (password + persona) | `/login`, `app/login/actions.ts` | Rate-limited shared-password gate, signed 12 h session | Works. Open-redirect attempts stay on site (A, 3 cases). 11th wrong password refused (A L1) | U `tests/auth/*` | #109 | Verified working (demo grade) | Keep; replace with OIDC for enterprise |
| 2 | One-click public demo | `/login` quick demo | Read-only 1 h synthetic sessions | Works; public analyst cannot write (A W, C) | U, C | #153 closed | Verified working | Keep for demo only |
| 3 | Sign out / switch role | header controls | Clear cookies, return to login | Cookie cleared (A S1). Token itself stays valid until expiry (A S2 known gap) | U `logout.test.ts` | #109 | Partially working | Server-side revocation needs #109 |
| 4 | Session expiry on form submit | `proxy.ts` | Send the user to sign in without losing context | Before the fix: unexpected-response error screen | U `proxy.test.ts` | #199 / PR #202 | Fixed in PR #202, verified in browser | Merge PR #202 |
| 5 | Persona route boundaries | `proxy.ts`, `lib/demo-personas.ts` | Each persona reaches only its routes | 24 page and RSC denials pass (A R) | U `demo-personas.test.ts` | | Verified working | Keep |
| 6 | Navigation per persona | `components/nav.tsx` | Show only routes the viewer can open | Fallback and signed-out nav showed analyst links | U `nav-fallback.test.ts` | #203 / PR #205 | Fixed in PR #205 | Merge PR #205 |
| 7 | Workbench overview | `/` | Review priorities and portfolio state | Renders for staff personas (C) | U queries | #110 | Verified working (synthetic) | Improve drill-downs (#110) |
| 8 | Review queue | `/queue` | Prioritised flagged invoices | Renders (C); latency p50 10 ms locally | U | #113 | Verified working | Keep |
| 9 | Case workboard and SLA | `/queue/cases`, `/queue/sla` | Ownership, SLA state | Read-only synthetic views (C). No assignment actions | U `tests/workflow` | #105, #113 | Partially working | Wire case store (#105) |
| 10 | Invoice Check batches | `/batches`, `/batches/[id]` | Batch summary, concentration, invoice list | Works (C, R). Layout overflow fixed in PR #201 | U checks | #189-#191 / PR #201 | Verified working | Merge PR #201 |
| 11 | Deterministic checks (11 rules) | `lib/checks/*` | Flag invoice risks with evidence | Pure functions with positive, negative and edge tests; eval precision/recall reported | U `tests/checks` (per rule) | | Verified working | Keep |
| 12 | Decision (approve/hold/reject) | decision form, `decideAction`, `lib/trust/decide.ts` | Record decision, snapshot and audit atomically, idempotent, reject stale reviews | Works (A W persistence). Stale-fact gap fixed in PR #198 | U `tests/trust/*`; real PostgreSQL concurrency script | #182, #185 / PR #198 | Verified working after PR #198 | Merge PR #198 |
| 13 | Maker-checker approval | `lib/workflow/case-machine.ts`, `case-store.ts` | Second person approves | **Library only.** No page or action calls the case store; CHECKER has no sign-off | U `tests/workflow` | #105 | Library only | Build vertical slice (#105) |
| 14 | Shadow / assist mode | `setModeAction`, SPEC 9.1 | Hide agent output until decided | Works (C) | U | | Verified working | Keep |
| 15 | Agent explanation | `lib/agent/*`, `rerunAgentAction` | Evidence-cited explanation, validator as guarantee | Validator rejects ungrounded claims. Monetary bypasses fixed in #186. Prompt-injection rule added in #204 | U `tests/agent/*` (scripted model) | #186, #188, #204 | Partially working until #186 and #204 merge | Merge fixes; keep validator authoritative |
| 16 | Agent re-run limits | `rerunAgentAction`, `lib/rate-limit.ts` | 10/h session, 10/h IP, 200/day | Code inspected; limiter verified for login (A L1). No provider call made in audit | U `rate-limit.test.ts` | | Verified (limiter), provider unverified | Keep |
| 17 | Portfolio Watch and incidents | `/watch`, `incidentAction`, `/api/watch/run` | Daily idempotent rules; acknowledge or resolve with audit | Renders (C). Cron rejects bad bearer (A C1). Date filter crash fixed in PR #196 | U `tests/watch/*` | #192 / PR #196 | Verified working after PR #196 | Merge PR #196 |
| 18 | Risk trends | `/watch/trends` | Historical trend view | Renders (C) | U | #101 | Verified working (synthetic) | Versioned thresholds (#101) |
| 19 | Clients directory and dossier | `/clients`, `/clients/[id]` | Relationship view | Renders (C); CLIENT persona blocked (A) | U queries | #111 | Verified working | Extend (#111) |
| 20 | Client activity, collections, source health | `/clients/[id]/*` | As-of activity, collections risk, reconciliation | Renders (C); cash allocation fixes merged in #194 | U | #183, #187 closed | Verified working | Keep |
| 21 | Client collateral scenario | `/clients/[id]/borrowing-base` | Read-only what-if on dated facts | Renders (C) | U | #112 | Verified working | Keep |
| 22 | Borrowing-base calculation | `lib/credit/borrowing-base.ts`, `/borrowing-base` | Integer-cent eligibility, concentration, advance, reserves, headroom | 20,000 random cases match an independent BigInt oracle (O) | U `tests/credit` | #102, #112 | Verified working | Approve policy values with domain owner |
| 23 | Facility models (revolving/term) | `lib/credit/facility.ts` | Principal schedules | **Library only** | U | #108 | Library only | Build when product scope is approved |
| 24 | Drawdown simulation | `lib/funding/simulation.ts` | Controlled drawdown ledger | **Library only**; no money movement by design | U | #107 | Library only | Keep out of production until approved |
| 25 | Credit memo draft and export | `/credit-memos`, `/credit-memos/[id]/export` | Source-bounded draft, unsigned export | Renders and exports (C); CLIENT blocked from export (A) | U `memo-export.test.ts` | #114 | Partially working | Sign-off and versioning (#114) |
| 26 | Portfolio review pack export | `/portfolio/export` | Deterministic Markdown with digest, private no-store | Verified digest and headers (C); CLIENT blocked (A); p50 34 ms | U | #163 closed | Verified working | Keep |
| 27 | Trust Panel, agreement, replay | `/trust`, `/trust/replay/*` | Agreement metrics, snapshot replay with SHA-256 chain | Renders (C). Replay checksum verified in earlier hosted acceptance | U `tests/trust/*` | | Verified working | Keep |
| 28 | Evaluation | `/trust/evaluation` | Check precision/recall, agent pass rates | Renders (C); table overflow fixed in PR #201 | U `tests/eval` | #191 / PR #201 | Verified working after PR #201 | Merge PR #201 |
| 29 | Audit log | `/audit` | Append-only history | Renders for AUDITOR (A). Append-only trigger verified in earlier migration work | U | | Verified working | Keep |
| 30 | Ingestion health | `/operations/sources` | Synthetic sync state, retries | Read-only synthetic view (C) | U `tests/data` | #100 | Partially working | Real ingestion contracts (#100) |
| 31 | Xero / Akahu connectors | `lib/data/xero.ts`, `akahu.ts`, `provider-contract.ts`, `sync-retry.ts`, `ingest-store.ts` | Opt-in sandbox connectors | **Library only**, synthetic fixtures; no OAuth app, no credentials | U | #106 | Blocked | Needs provider sandbox apps and consent |
| 32 | Borrower demo view | `/demo/client` | Fictional borrower snapshot, pinned client | Works; no other route reachable (A R CLIENT) | U | | Verified working | Keep |
| 33 | About | `/about` | Product statement | Renders | | | Verified working | Keep |
| 34 | Security headers | `next.config.ts` | Baseline CSP and framing protections | Missing on `main` (live check); added in PR #200 | U `headers.test.ts` | #197 / PR #200 | Fixed in PR #200 | Merge PR #200 |
| 35 | Toolchain versions | `package.json`, CI | Supported runtime and dependencies | Prior worktree prepared; not re-verified in this session | | #181 | Not verified this session | Finish #181 |

## Unnecessary or misleading items

No page was found that claims a capability it does not have. Synthetic-only pages state their scope in the UI. Items to watch:

- Rows 13, 23, 24 and 31 are library code with tests but no product surface. Their docs say so. Do not advertise them as product features until wired.
- The CHECKER persona label says "without sign-off authority", which is accurate, but no checker workflow exists. Consider hiding the persona until #105 ships. That is a product decision.
