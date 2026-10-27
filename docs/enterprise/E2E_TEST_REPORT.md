# End-to-end test report

Run date: 2026-10-27 (NZDT). This report records only checks that were executed. Anything not run is listed under "Not executed".

## Environment

| Item | Value |
| --- | --- |
| Code under test | `main` at `41bf8b1`, plus the open fix branches named per result |
| Build | `next build` (Next.js 16.4.2, Turbopack), served with `next start` |
| Database | Local PGlite, seeded with `npm run seed -- --target=local` (synthetic: 4 clients, 251 invoices, 38 with findings, 263 watch detections over 90 days). Started with `CI=true CREDIT_DESK_CI_PGLITE=1`, the CI browser-smoke mode |
| Credentials | Throwaway `DEMO_PASSWORD` and `SESSION_SECRET` generated per run, never reused, never committed |
| Browsers | Playwright Chromium and WebKit (Playwright 1.56 runner) |
| Host | Apple M6, 12 cores, macOS; Node.js 26.10.0 locally (CI uses `.nvmrc`) |
| Hosted deployment | Not written to. One read-only `GET /login` checked live response headers |
| Model provider | Not called. Agent behaviour is tested with a scripted model |

## 1. Authorization and session probe

Command: `AUDIT_URL=http://127.0.0.1:3197 DEMO_PASSWORD=... SESSION_SECRET=... PLAYWRIGHT_PACKAGE=... node scripts/audit-authorization-probe.mjs`. The script refuses non-local targets.

Result: **46 checks: 43 passed, 3 known gaps, 0 failed.** Built from PR #200 with the final header policy.

| Group | Checks | Result | What was verified |
| --- | --- | --- | --- |
| H security headers | 2 | Pass | CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff` and `Referrer-Policy` on `/login` and `/api/watch/run` |
| C cron route | 1 | Pass | `/api/watch/run` with a wrong bearer token returns 401 |
| A authentication | 5 | Pass | No cookie, tampered persona, expired token, unknown persona and wrong signing secret all redirect to `/login` |
| R route boundaries | 26 | Pass | 24 denials: CLIENT on 8 staff routes including `/portfolio/export`, `/credit-memos/cli_0001/export` and `/clients/cli_0002`; AUDITOR on 3; CHECKER on `/audit`. Each as a page and as an RSC request (`rsc: 1`). Plus 2 allowed: own-home access returns 200 for CLIENT and AUDITOR |
| L login rate limit | 1 | Pass | The 11th wrong password from one address returns "Too many attempts" |
| O open redirect | 3 | Pass | `next=//evil.example/x`, `/\evil.example` and `https://evil.example/` all land on the same origin after a real password sign-in |
| S sign-out | 2 | 1 pass, 1 known gap | The cookie is cleared. **Gap:** the captured token replayed after sign-out still returns 200, because sessions are stateless (#109) |
| W write denial | 4 | Pass | CLIENT, CHECKER, AUDITOR and public ANALYST submit a decision through the analyst's form with a unique reason. After reload that reason is absent, while the analyst's own submission on the same form is recorded |
| U denial UX | 2 | Known gap | CLIENT and AUDITOR submissions on `main` end in "An unexpected response was received from the server." Fixed in PR #202 (#199) |

Evidence file: `audit-authorization-results.json` (written per run, not committed).

## 2. Session-expiry form submission (#199, PR #202)

Debug harness with Playwright: open an invoice as analyst, choose Hold, enter a reason, then replace the session cookie before submitting.

| Case | `main` | PR #202 |
| --- | --- | --- |
| Expired token | `POST 307 -> /login`, then `pageerror: An unexpected response was received from the server.`; form gone | Navigates to `/login?next=%2Fbatches%2Fbat_0008%3Finvoice%3Dinv_0222`, no page error |
| CLIENT persona | Same error after a 307 to `/demo/client` | Navigates to `/demo/client`, no page error |
| CHECKER persona (route allowed) | `Only the credit analyst demo can record synthetic decisions.` | Unchanged |

## 3. Navigation per persona (#203, PR #205)

| Check | `main` | PR #205 |
| --- | --- | --- |
| Signed-out `/login` nav links | Full analyst nav | `/about` only |
| CLIENT initial HTML links | `/ /about /audit /batches /borrowing-base /clients /credit-memos /queue /trust /watch` | `/about /demo/client` |
| Redirected (307) requests during page load, 5 personas | CHECKER prefetched `/audit` and was redirected | 0 for every persona |

## 4. Responsive layouts (PR #201)

`scripts/review-responsive-layouts.mjs` at 320, 390, 768, 1024, 1440 and 1920 px across workbench, batch, invoice, evaluation and navigation states.

| Engine | Result |
| --- | --- |
| Chromium | Pass, all widths |
| WebKit | Pass for layout, overflow and focus checks. Keyboard arrow-scrolling of table regions is **unverifiable**: Playwright WebKit does not keyboard-scroll any focused overflow element, including a minimal static page (`scrollLeft` 0 versus 40 in Chromium) |
| Firefox | Not run: the local macOS Firefox binary fails before page load |

## 5. Financial calculation oracle

An independent BigInt implementation was written from the documented rules: per-invoice net of receipts and credits; ineligible exclusion; debtor cap as a share of eligible collateral in invoice-ID order; per-invoice floor advance; reserves; facility headroom. It was compared with `borrowingBase()` on 20,000 randomised cases. Advance and share rates ranged over 0 to 10,000 bps, with 1 to 8 invoices and 3 debtors, and every 50th case used values near `Number.MAX_SAFE_INTEGER / 16`.

Result: **20,000 cases, 0 mismatches** on eligible collateral, gross advance and available amount. Script: `bb-oracle.ts`, kept with the audit evidence (not committed).

## 6. Real PostgreSQL concurrency (PR #198)

`scripts/verify-review-concurrency.ts` against an isolated Neon database (`creditdesk_audit_182` on branch `br-little-block-a7rms69y`, never production). Result `PASSED` on six checks: official migrations; single snapshot with stale rejection; source-update, credit and phantom explanation consistency; chain-lock serialization retry; concurrent identical-key retry keeping one history; full-UUID collision regression.

## 7. Performance baseline

Same disposable build and dataset. Sequential runs used 15 requests per route after one warm-up, authenticated as analyst.

| Route | p50 | p95 | max |
| --- | --- | --- | --- |
| `/` | 12 ms | 16 ms | 21 ms |
| `/queue` | 10 ms | 10 ms | 11 ms |
| `/batches/bat_0008?invoice=inv_0229` | 12 ms | 13 ms | 13 ms |
| `/clients/cli_0001` | 17 ms | 18 ms | 19 ms |
| `/watch` | 7 ms | 8 ms | 9 ms |
| `/audit` | 6 ms | 6 ms | 6 ms |
| `/portfolio/export` | 34 ms | 36 ms | 37 ms |

Concurrency: 50 requests to `/queue` at 10 in parallel. 50/50 returned 200; p50 64 ms, p95 86 ms, max 99 ms.

Limits: the database is in-process PGlite with a 251-invoice dataset. These numbers exclude network and Neon latency and say nothing about large portfolios. No load test against hosted infrastructure was run. Doing so needs an approved isolated environment.

## 8. Automated suites

| Branch | Tests | Typecheck | Lint | Format | Build | Bundle scan | Eval |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PR #198 (fix/182) | 492 pass | Pass | 0 errors, 7 existing warnings | Pass | Pass | (CI) | (CI) |
| PR #200 (fix/197) | 477 pass | Pass | same | Pass | Pass | Pass | (CI) |
| PR #201 (fix/189) | 474 pass | Pass | same | Pass | Pass | (CI) | (CI) |
| PR #202 (fix/199) | 478 pass | Pass | same | Pass | Pass | Pass | (CI) |
| PR #205 (fix/203) | 481 pass | Pass | same | Pass | Pass | Pass | (CI) |
| fix/186 (pre-PR) | 612 pass | Pass | same | Pass | Pass | Pass | Pass |
| fix/204 (pre-PR) | 478 pass | Pass | same | Pass | Pass | Pass | Pass |

GitHub CI (`verify` plus `visual-review` browser smoke) passed on PRs #195, #196, #198, #200, #201 and #202. PR #205 was pending at the time of writing.

## Not executed

- Physical phones and tablets; Safari on iOS; Firefox; screen readers.
- Load tests against Neon or Vercel; datasets larger than the synthetic seed.
- Any live model-provider call; prompt injection was tested with a scripted model only.
- Xero, Akahu or bank sandbox flows (no provider apps or credentials exist).
- Backup restore drill on the hosted database.
- Offline and slow-network behaviour.
