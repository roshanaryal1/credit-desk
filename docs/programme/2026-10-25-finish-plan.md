# Credit Desk: executable remainder plan (25 October 2026)

This plan **supplements** the original programme execution plan. The owner
authorized independent review, fixes, tested merges and synthetic deployment.
Every demonstration input is fictional. A green CI build is not real-lending
or external policy sign-off.

| Sequence | Issues | Delivery slice | Exit condition / proof |
| --- | --- | --- | --- |
| 0 | #165, #166, #163 | Review the recording, exposure correction, and deterministic portfolio export | Exact-head CI, hosted browser evidence, security/correctness review |
| 1 | #161 | Compare dated client collateral assumptions | One source snapshot, pure kernel only, validated inputs, invoice and waterfall deltas, zero writes |
| 2 | #160, #100 | Synthetic source-health and cash allocation reconciliation | Client/as-of partition, no future observations, FRESH/STALE/ERROR/UNKNOWN, fully reconciled cents |
| 3 | #162, #114 | Structured fictional evidence requirements and memo metadata | Fixed scenario date, stable requirement IDs, borrower isolation, unsigned export |
| 4 | #164 | Immutable per-run fetched evidence record | Atomic run/manifest/explanation writes, original evidence revalidation, no substitution by current data |
| 5 | #101–#105, #110–#114 | Effective-dated risk policies, completeness of credit and client workflows | End-to-end synthetic journey, independent financial-domain fixtures, accessible UI |
| 6 | #109 before #105/#113 privileged writes | Verified OIDC subject, MFA, enforcement and access logs | Negative identity/authorization tests, explicit provider setup, redacted operations |
| 7 | #106–#108 | Optional sandbox connectors, money-movement design, facility economics | Written provider authorization, external policy/security/privacy approvals, no production payment execution before sign-off |
| 8 | #135, #99 | Integrated release/UAT and administrative issue closure | Evidence by requirement, signed acceptance, no hidden blockers |

## Per-slice definition of done

1. Implement a bounded change on a branch; no direct push to main.
2. Update documentation and exact behavioral limitations.
3. Add deterministic success/failure/date/isolation tests; verify every NZD
   figure is integer cents and that exceptions fail closed.
4. Run typecheck, lint, Prettier, all tests, build, bundle-secret scan, eval,
   browser routes/keyboard/mobile checks on the PR head.
5. Review the PR and verify the latest workflow SHA before merger.
6. Never silently close parent issues on the strength of incomplete child PRs.

## Current external dependencies

- The prototype's self-selected personas are **not** independently verified
  users. Real maker/checker assignment depends on #109 OIDC/MFA and tenant
  authorization.
- Live Xero/Akahu data requires written authorization, connection setup,
  controlled secret storage and security/privacy readiness.
- Lending rules, facility terms, reserves, drawdowns and disbursement need
  lender-approved credit policy and domain-led reconciliation.
- Operational ingestion requires a supervised worker, alerts, retention,
  recovery and incident-response procedures.
- Independent security, accessibility and credit-domain acceptance must be
  documented before any real borrower, bank, invoice or funding operation.

No task with an external dependency should be reported as production complete
merely because an illustrative synthetic implementation passes its tests.
