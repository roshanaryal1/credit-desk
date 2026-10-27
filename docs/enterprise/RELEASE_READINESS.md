# Release readiness

Assessed 2026-10-27 against the sixteen enterprise acceptance gates. "Met" requires evidence from this audit or recorded CI; anything else is "Partially met", "Not met" or "Unverified".

## Verdict

- **Synthetic demonstration (current deployment):** suitable once the open fix PRs merge. Core flows work and are evidenced on fictional data.
- **Production use with real borrower or lender data:** **not ready.** Gates 2, 3, 10 and 13 are not met, gate 15 is unverified, and gates 5, 7, 11 and 16 are partial. Several need owner decisions or external credentials.

## Gates

| # | Gate | Status | Evidence or blocker |
| --- | --- | --- | --- |
| 1 | Critical business workflows complete end to end | Met (synthetic scope) | CI browser smoke; probe W decision persistence; E2E report |
| 2 | No unresolved P0 or P1 defects | **Not met** | P0 for real data: #109 (identity), #105 (maker-checker). P1 fixes open in PRs #195, #198 and PR #208, not merged |
| 3 | No unauthorized access or cross-tenant exposure | **Not met** for real data | Route and write boundaries verified for personas (probe R, W). There is no tenant model, and token replay after sign-out is accepted (probe S2) |
| 4 | Financial calculations pass independent tests | Met (calculation) | 20,000-case BigInt oracle; unit tests. Policy values still need a policy owner |
| 5 | All supported roles have verified journeys | Partially met | Five personas verified for routes and writes; no Administrator role; CHECKER has no workflow |
| 6 | Every visible action has meaningful function | Met | No fake actions found; library-only modules are not exposed |
| 7 | CI passes for proposed changes | Partially met | Green on PRs #195, #196, #198, #200, #201, #202; pending on #205, #206 and PR #208 at the time of writing |
| 8 | Database migrations tested | Met for existing migrations | Real PostgreSQL verifier ran official migrations; no new migrations in this audit |
| 9 | Integrations accurately classified | Met (classification) | Xero and Akahu are fixtures only (#106) and labelled so; only the LLM provider is live |
| 10 | Useful observability for critical operations | **Not met** | Structured logs only; no alerts or SLOs |
| 11 | Browser, API and integration tests pass | Partially met | Chromium pass; WebKit pass except engine-unverifiable keyboard scroll; Firefox and devices not run |
| 12 | Security findings addressed or documented as blockers | Met | SECURITY_REVIEW.md |
| 13 | Backup and recovery tested | **Not met** | No restore drill in this audit |
| 14 | Documentation matches behaviour | Met for audited areas | SPEC, ADRs, these documents |
| 15 | Performance meets agreed targets | **Unverified** | No agreed targets; local baseline only (p50 6 to 34 ms, PGlite, 251 invoices) |
| 16 | Core workflows accessible and usable on supported devices | Partially met | Responsive runs at 6 widths; earlier axe checks with 0 violations; no physical devices or screen readers |

Count: 7 met, 4 partially met, 4 not met, 1 unverified.

## Area summary

| Area | Initial status (2026-10-27 baseline) | Final verified status | Remaining blockers |
| --- | --- | --- | --- |
| Core functionality | Working on synthetic data | Working; journeys verified by probe and CI | Maker-checker (#105) |
| Financial calculations | Implemented, unit tested | Oracle-verified; stale-approval gap fixed (PR #198) | Policy values approval |
| Frontend / UX | Overflow and focus defects; error screen on expiry; misleading nav | Fixed in PRs #201, #202, #205 | Merge; devices; checker UX |
| Backend / APIs | Sound layering | Unchanged, verified | Observability |
| Database integrity | Append-only, chain | Plus serializable decisions (PR #198) | Restore drill |
| Authentication / RBAC | Demo gate | Boundaries verified; gaps documented | #109 IdP decision |
| AI reliability | Validator with bypasses | Bypasses fixed (PR #208); injection rule and tests (PR #206) | Structured amounts; live-model testing |
| External integrations | Fixtures only | Unchanged, classified | Provider apps and credentials (#106) |
| Security | No headers; provider leak | Headers (PR #200); diagnostics (PR #195) | #109, privacy assessment |
| Test coverage | 474 tests on `main` | Up to 624 on PR #208; new probe and oracle | Firefox, devices, load |
| Performance | Not measured | Local baseline measured | Hosted load test, agreed targets |
| Operational readiness | Logs only | Unchanged | Alerts, runbooks, restore drill |

## Completion measure

No overall percentage is given. A defensible denominator would be the acceptance criteria of #99 to #114 plus the 16 gates above. Several of those criteria need decisions that have not been made, so a percentage would overstate precision.
