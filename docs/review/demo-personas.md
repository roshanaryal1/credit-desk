# Demo personas (synthetic release only)

This document describes a **self-selected demonstration experience**, not tenant authentication. A visitor with the existing shared demo password can select any perspective. The choice **never verifies employment, lender authority, borrower ownership, or an independent checker**. Do not use any of these roles with real financial data.

| Demo perspective | Landing | Visible journey | Mutations |
| --- | --- | --- | --- |
| Employer / lender | Workbench | Whole fictional portfolio and risk history | None |
| Credit analyst | Review queue | Invoice checks and existing synthetic shadow-mode decision exercise | Synthetic decisions, incident notes and optional sandbox agent reruns only |
| Credit checker | Review queue | Credit review, scenarios and draft memos | None (no actual maker–checker sign-off) |
| Client / borrower | Fictional client snapshot | Aggregate facility and receivables for server-pinned `cli_0001` | None |
| Auditor | Audit history | Synthetic audit, replay and evidence | None |

## Public one-click demo (issue #153)

Five clickable fictional example email addresses are displayed under the reviewer sign-in. No public password is exposed or required; each button issues a separate short-lived signed session for its chosen perspective. These addresses do not receive mail. Public one-click sessions are **read-only even when Analyst is selected**, and do not allow incident changes, agent reruns, decision writes or mode changes. Existing password-protected reviewer sign-in retains the synthetic Analyst exercise.

Enable only on an **isolated, seeded, verified fictional-data deployment**, with `PUBLIC_DEMO_ENABLED=1` and `CREDIT_DESK_DATA_CLASSIFICATION=SYNTHETIC`, and with valid `DEMO_PASSWORD` and `SESSION_SECRET` configured on the server. The second flag is an operator assertion, **not an automated database provenance verifier**; do not set either flag on a deployment with real borrower, lender or banking data. Never expose the actual shared password in the browser or documentation. Public sessions expire after 60 minutes and are limited by IP and global counters in the database. Turning off the flag prevents new one-click sessions; rotate `SESSION_SECRET` to revoke already issued sessions.

## Controls and limitations

- Rate-limited shared-password gate remains mandatory in production; role selected via accessible fieldset and bound to signed expiring session cookie.
- Route policies restrict read pages and hide out-of-scope links. Client view reads a constant server-side fictional client ID and provides no access to the portfolio directory, staff decisions, or raw other-client data.
- Every state-changing demo server action separately checks for the synthetic analyst persona. A request cannot obtain write access by hiding/revealing buttons or changing URL parameters.
- A person can still choose the analyst persona when signing in. This is deliberately **not an authentication/authorization layer for real customer data**.
- Existing signed sessions without persona claim remain analyst until expiry (12 hours maximum); rotate the demo session signing secret to invalidate all when needed.
- The independently authenticated watch cron endpoint uses its own secret, not any demo persona.
- No funding transfers or real dual-approval rights are granted. OIDC identities, MFA, per-tenant grants, session revocation, role-attributed audit and enforcement at each DB access remain required for #109 enterprise scope.
- Do not assume a hosted serverless function may persist an unconfigured PGlite DB. A separately seeded Postgres demo DB is required for real hosted walkthrough (#76).

## Review steps

1. Sign in as Client with the shared password; inspect only the fixed borrower snapshot. Attempt direct `/clients`, `/queue`, and `/audit` — each must redirect to the borrower view. Confirm sign-out allows switching.
2. Sign in as Employer, Checker, Auditor; confirm filtered navigation and that only the credit analyst can change synthetic records.
3. Sign in as Analyst; ensure existing shadow decision and audit-replay flows are preserved.
4. Confirm incorrect passwords, expired or tampered cookies, keyboard radio selection, 390px and 1440px display and an unseeded demo DB fail in clearly labelled states.

No production-domain or secret configuration is changed by this PR.
