# Security review

Review date: 2026-10-27. Baseline: `main` at `41bf8b1`. Method: code inspection of every route, server action and route handler; an executable authorization probe against a disposable production build (see [E2E_TEST_REPORT.md](E2E_TEST_REPORT.md)); a read-only header check of the hosted site; and an independent Codex review of every fix.

OWASP ASVS 4.0 Level 2 areas are used as a checklist. This is **not** an ASVS certification, a penetration test, or a New Zealand Privacy Act 2020 compliance opinion.

## Summary

Credit Desk handles **synthetic data only** and is protected by a shared demo password with self-selected personas. Within that scope, route and write boundaries hold under adversarial testing. For real customer data, the identity model is the main release blocker.

| Area | Finding | Severity | Status |
| --- | --- | --- | --- |
| Identity | Demo mode: shared password; persona self-selected; analyst attribution self-declared (`lib/session.ts`) | **Release blocker for real data** | Fixed in PR #219 (OIDC with MFA, `lib/identity/`); demo mode remains on the live deployment until an IdP is configured |
| Session revocation | Signed stateless cookie; replay after sign-out still accepted until expiry (12 h, or 1 h public) | P1 for real data | Fixed for OIDC sessions in PR #219 (hashed database sessions). Demo cookies still stateless (probe S2) |
| Tenant isolation | No tenant model. The CLIENT persona is pinned to `cli_0001` server-side; staff personas see every synthetic client | Release blocker for real data | Client grants and realm binding in PR #219 (OIDC mode). Portfolio-wide lists need per-grant filtering |
| Route authorization | `proxy.ts` persona prefixes, including RSC and export routes | n/a | Verified: 24 denials and 2 allowed (probe R) |
| Write authorization | Each server action checks `canPerformDemoWrite` | n/a | Verified by persistence for CLIENT, CHECKER, AUDITOR and public ANALYST (probe W) |
| Token integrity | HMAC-SHA256, expiry, persona allow-list | n/a | Verified: tampered, expired, unknown persona and wrong key rejected (probe A) |
| Security headers | No CSP, frame-ancestors, XFO, Referrer-Policy or Permissions-Policy on the hosted site (HSTS present) | P2 | Fixed in PR #200 (#197) |
| Denied action UX | Expired or wrong-persona form submit ends in a client error screen | P2 | Fixed in PR #202 (#199) |
| Prompt injection | Source-record text reaches the model; no prompt rule; no tests | P2 | Fixed in PR #206 (#204); validator remains the guarantee |
| AI money grounding | Unsupported monetary forms could pass the citation validator | P1 | Open. PR #208 closed unmerged after free-text parsing did not converge; replaced by structured figures (#212) |
| Stale approvals | Decisions could be recorded after reviewed financial facts changed | P1 | Fixed in PR #198 (#182, #185) |
| Provider diagnostics | Raw provider errors could reach logs and outcomes | P1 | Fixed in PR #195 (#188) |
| Navigation disclosure | Fallback nav showed analyst links to every persona (no data) | P3 | Fixed in PR #205 (#203) |
| Rate limiting | Login 10 per 15 min per address plus a global cap of 200; quick demo 30 per address; agent re-run 10/h | n/a | Verified for login (probe L1) |
| Rate-limit key trust | `x-real-ip` is trusted when `x-vercel-forwarded-for` is absent. On Vercel the platform header wins; on any other host without a proxy, clients can rotate this header to get fresh per-address buckets (the global cap still holds) | P3 | Documented in `lib/request.ts`; deployment note below |
| Open redirect | `safeNext` normalises `next` | n/a | Verified (probe O, 3 cases) |
| CSRF | Next.js server actions check Origin; cookies are `SameSite=Lax`, `HttpOnly`, `Secure` in production | n/a | Inspected; not separately fuzzed |
| Cron endpoint | Bearer secret with constant-time comparison | n/a | Verified (probe C1) |
| Secrets | Secrets only in environment; `server-only` imports; client bundle scan in CI (`check:bundle`) | n/a | Bundle scan passed on each branch |
| Injection (SQL) | Drizzle query builder with parameters; `sql` templates bind values | n/a | Inspected; no string-built SQL found in request paths |
| Export injection | Portfolio and memo exports escape Markdown, HTML and formula prefixes | n/a | Unit tests exist (`memo-export.test.ts`) |
| Audit integrity | Append-only tables with a trigger; SHA-256 snapshot chain | n/a | Chain verified by tests and the real PostgreSQL script |
| Dependency audit | `npm audit` reported 0 vulnerabilities in the previous release session | n/a | Not re-run in this session; #181 updates versions |
| Local toolchain | A local tooling check reported the workstation's Node.js 26.10.0 as affected by a Brotli decoder vulnerability (CVE-2026-111497). **[UNVERIFIED]**: not confirmed against the Node.js security advisories in this audit | Ops | Confirm at nodejs.org security releases, then upgrade the workstation. CI and Vercel use `.nvmrc` |

## Residual risks and release blockers

**Blockers for any real borrower or lender data:**

1. **Identity and access (#109).** Implemented in PR #219: OIDC with MFA, per-user identity in audit events, client grants on every scoped read and action, server-side session revocation and an administration role. It must be enabled with a configured identity provider, and portfolio-wide lists need per-grant filtering.
2. **Data protection and privacy.** No data classification beyond the `SYNTHETIC` operator flag, no retention or deletion policy, and no privacy impact assessment. Use with personal information under the NZ Privacy Act 2020 needs a privacy officer's review.
3. **Backup and recovery.** The hosted database is a Neon free project. Point-in-time restore behaviour and a restore drill have not been verified in this audit.
4. **Operational monitoring.** Structured logs exist for watch runs and agent outcomes. There are no alerts, no error-rate SLOs and no incident runbook for security events.

**Accepted for the synthetic demo:** shared password, self-selected personas, public one-click read-only sessions on a deployment flagged `SYNTHETIC`.

## Deployment notes

- Keep Vercel as the host, or put a trusted reverse proxy in front, so `lib/request.ts` never trusts a client-supplied address.
- In demo mode, rotate `SESSION_SECRET` to revoke every session. OIDC mode revokes sessions individually (PR #219).
- After PR #200, consider hash-based CSP (SRI) to remove `script-src 'unsafe-inline'`.
