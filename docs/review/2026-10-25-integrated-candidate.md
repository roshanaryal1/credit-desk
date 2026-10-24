# Credit Desk — integrated synthetic review (25 October 2026)

## Scope and provenance

This is a **review-only, unmerged** branch combining draft PRs #142–#151.
Each contributing PR remains independently open and reviewable. The prototype
may only be exercised with fictional data. No real lender decision, verified
checker authority, bank payment, Xero/Akahu connection or production rollout
is authorised by CI.

| PR | Integrated slice |
| --- | --- |
| #142 | Dated, source-linked debtor collections metrics; DSO deliberately unavailable |
| #143 | Historic Portfolio Watch status excludes later NZ-local actions |
| #144 | Canonical `creditdesk.roshanaryal.com` documentation |
| #145 | Five shared-password, self-selected fictional demo perspectives |
| #146 | Read-only database schema and seed preflight |
| #147 | Client-scoped dated activity timeline |
| #148 | Production database must fail closed without external PostgreSQL |
| #149 | Persisted, clearly fictional case-workboard states and filters |
| #150 | Source-validated unsigned credit memo Markdown download |
| #151 | Descriptive incident trend and resolution observations |

## Explicit integration conflict resolutions

- `app/clients/[id]/page.tsx`: both activity history and collections
  drilldown links are retained, alongside the existing collateral scenario.
- `app/watch/page.tsx`: the new trends link coexists with demo-persona
  read-only incident action restrictions.
- `README.md`: retain the five-persona instructions and add the canonical
  demonstration hostname without reverting the integrated `main` status.
- `docs/deploy.md`: combine canonical domain, read-only preflight and
  fail-closed database guidance; no deployment is performed.
- `scripts/review-ui-smoke.mjs`: include all new read routes in a signed,
  seeded desktop/mobile browser walkthrough and retain client-role isolation
  checks.

## Reviewer journey

1. Sign in with the shared demo password as Credit Analyst. Visit the workbench
   and `/queue`, then the fictional `/queue/cases` workboard. Cases have
   demo assignees only; approving real funds is impossible.
2. Open `/clients/cli_0001`, its `/activity` and `/collections` routes,
   and the separate ledger-linked `/borrowing-base` demonstration. Distinguish
   committed headroom from available-to-draw funding.
3. Visit `/watch` and `/watch/trends` and check history using earlier
   business dates. Later actions must never appear in earlier snapshots.
4. Visit `/credit-memos/cli_0001` and download the draft. It must include
   evidence identifiers, missing facts and a prominent unsigned/no-approval
   disclosure.
5. Switch the demo login to Client/Borrower, then to Checker or Auditor.
   Client navigation to any lender portfolio/queue route must be restricted;
   non-analysts cannot mutate synthetic credit decisions.
6. Review the Trust Panel, one shadow decision and its replay on an approved,
   isolated synthetic deployment once the database is explicitly ready.

## Gates not satisfied by green CI

- #76: Hosted Neon migration, non-destructive fixture seed, correct
  Vercel environment/commit and actual authenticated external browser tests.
- #77: Actual three-minute walkthrough recording and persistent README link.
- #100–#105 and #110–#114: Outstanding lender policy approval, true
  source observation-time provenance, historic facility revisions, DSO input
  completeness, persisted governed policy and genuine reviewer workflows.
- #106–#109: Real-provider consent and OAuth, payment settlement authority,
  multi-product economics, verified OIDC/MFA and independent security review.
- #99/#135: Owner acceptance, release freeze and independent financial,
  privacy, accessibility and recovery sign-offs.

Do **not** merge this integration PR or any source PR without explicit owner
review. Passing tests demonstrates reproducible synthetic behavior only.
