# Enterprise roadmap

Prepared 2026-10-27. Priorities: P0 security, financial correctness or data integrity; P1 broken core features; P2 important enterprise capability; P3 optional.

## Stage 1: merge open fixes (no new decisions needed)

Recommended review and merge order. Each PR targets `main` independently; later PRs may need a rebase.

| Order | PR | Issues | Priority | Why this order |
| --- | --- | --- | --- | --- |
| 1 | #198 | #182, #185 | P1 | Financial integrity of approvals; largest change, so merge first |
| 2 | #195 | #188 | P1 | Provider diagnostics redaction; independent |
| 3 | PR #208 | #186 | P1 | AI money grounding; touches `lib/agent` (rebase after #195) |
| 4 | #206 | #204 | P2 | Prompt-injection rule and tests; `lib/agent/prompts` (rebase after #186) |
| 5 | #200 | #197 | P2 | Security headers |
| 6 | #202 | #199 | P2 | Action-aware redirects in `proxy.ts` |
| 7 | #196 | #192 | P2 | Watch date validation |
| 8 | #201 | #189, #190, #191, #193 | P2 | Layout and keyboard access |
| 9 | #205 | #203 | P3 | Navigation fallback; touches `components/nav.tsx` like #201 (rebase after #201) |
| 10 | #181 work | #181 | P1 | Toolchain upgrade last, so the fixes above are verified on known versions first |

Acceptance: CI `verify` and `visual-review` green on each final head; no unresolved review comments.

## Stage 2: decisions required from the owner

| Decision | Blocks | Options |
| --- | --- | --- |
| Identity provider | #109, #105, tenant isolation | Neon Auth with MFA, or existing company SSO (OIDC) |
| Lending policy values | #101, #102 | Advance rate, concentration cap, ineligibility ageing, reserves: approval by a credit policy owner. Code defaults are illustrative |
| Recommendation constraint | #204 follow-up | Whether AI `recommendation: APPROVE` is allowed when HIGH-severity findings exist |
| Data scope | Privacy, retention | Whether any real borrower data will be processed; triggers a privacy impact assessment |
| Provider sandboxes | #106 | Register Xero and Akahu developer apps; consent model |

## Stage 3: essential capabilities (after decisions)

| ID | Work | Priority | Depends on | Acceptance criteria | Tests |
| --- | --- | --- | --- | --- | --- |
| #109 | OIDC sign-in, MFA, per-user audit identity, tenant and client grants on every read and action, server-side session revocation, administration role | P0 | IdP decision | Probe S2 (replay after sign-out) rejected; cross-tenant reads denied for every route, action and export | Negative authorization matrix in CI; extend `audit-authorization-probe.mjs` |
| #105 | Maker-checker: wire `lib/workflow/case-store.ts` to queue actions; checker inbox; separation of duties | P0 | #109 | A maker cannot approve their own case; every transition is audited and replayable | State machine tests (exist), browser journey, concurrency |
| #100, #106 | Real ingestion: typed contracts, quarantine, reconciliation; Xero and Akahu sandbox OAuth | P1 | Provider apps | Sandbox sync end to end; failures quarantined and visible | Contract tests against sandbox; recorded fixtures |
| #101, #102 | Versioned, approved policy with effective dates; policy lifecycle UI | P1 | Policy owner | Every calculation shows its policy version and approver | Oracle tests per policy version |
| New | Structured AI amounts (`{cents, evidenceId}`) to retire the free-text money tokenizer | P1 | #186 merged | Prose with currency literals rejected; UI renders amounts from cited cents | Validator tests; eval |
| New | Observability: log drain, alerts on 5xx, agent failure rate, watch-run failure; runbook | P1 | None | Alert fires in a drill | Drill record |
| New | Backup and restore drill on the hosted database | P1 | Paid tier decision if PITR needed | Restore to a branch, verify snapshot-chain fingerprint | Drill record |

## Stage 4: competitive improvements

| Work | Priority | Notes |
| --- | --- | --- |
| Covenant terms as data and monitoring (#108) | P2 | Market-standard in facility management products |
| Document repository linked to cases | P2 | Evidence beyond ledger and bank records |
| Facility and drawdown ledger (#107) | P2 | No money movement without explicit approval |
| Configurable alerts and escalation (#101) | P2 | Owner and SLA per incident |
| Hash-based CSP (remove `unsafe-inline`) | P3 | After PR #200 |
| Borrower portal uploads | P3 | After #109 |

## Blockers that cannot be resolved in code

- Credentials: identity provider tenant, Xero and Akahu developer apps, model provider key for live evaluation.
- Approvals: credit policy values, privacy assessment, production data use, any paid infrastructure tier.
- Physical verification: real devices, screen readers, lender user acceptance testing.
