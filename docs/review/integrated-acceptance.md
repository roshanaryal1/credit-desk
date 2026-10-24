# Credit Desk 2.0 — single-pass review candidate

**Status:** DRAFT / synthetic-only / `main` merge freeze.
**Tracked under:** #99 and #135. **Integrated draft PR:** #136.
**Original change PRs:** #115–#134 and follow-up #137 (remain separately open).

## One-review operating model

Review the **integrated branch** once, not 21 isolated changes. This branch
assembles the proposed PR file snapshots without merging any PR into main.
It is not a signed-off release. No banking credentials, customer financial data,
automated payments or production deployment are enabled by this branch.

### Integration provenance

| Area | Original PRs | Integrated result |
| --- | --- | --- |
| Scope, architecture, visual language | #115, #117, #121 | SPEC proposal, ADRs, institutional workbench and shared design |
| Source history and recoverability | #118, #127, #132 | Provider-neutral events, append-only observation journal, migrations 0003/0004, bounded lease retry |
| Risk and finance | #116, #120, #123, #128, #129 | Borrowing base, debtor ageing, effective risk policy, illustrative funding waterfall and principal-only products |
| Client experience | #122, #125, #133 | Client dossier, receivables ageing and review queue in one navigation |
| Controlled workflow and security foundations | #119, #124, #131, #137 | Pure role/identity policy, durable offline credit cases and immutable decision history (migration 0005), and **offline-only** drawdown simulation |
| Credit narrative | #126, #134 | Source-limited memo assembler and draft review pages |
| Provider sandbox contracts | #130 | Synthetic accounting/bank adapter fixture tests |

The dependent file conflict resolutions are deliberate: nav from #125 with
added links to the borrowing-base and memo pages; client detail from #133;
schema and migration journal from #132, extended with #137's migration 0005. #133's `lib/risk/debtor-ageing.ts`
matches #120 byte-for-byte and is included **once**.

## Quick review route map (all synthetic)

1. `/` — executive overview; distinguish real underlying seeded fields from
   metrics not yet linked to the borrowing-base engine.
2. `/queue` — pending invoice batches and unresolved incidents, **read-only**
   triage. Does not assert an owner, a verified user, deadline or approval.
3. `/batches` → a batch → flagged invoice — original rule/evidence checks.
4. `/clients` → client — facility utilization, debtor mix, ageing and history.
   The receivables balance is different from the already-funded principal.
5. `/watch` — portfolio incidents, original action/replay behavior.
6. `/clients/cli_0001/borrowing-base` — **client-linked illustrative scenario**,
   computed from the client's dated synthetic ledger and funded position.
   It reconciles to Client 360 but is **not** signed-off drawable credit.
   `/borrowing-base` remains a separate four-invoice worked example.
7. `/credit-memos` → client memo — attributed seeded facility and funded
   balance facts, explicit missing underwriting evidence and no sign-off.
8. `/trust`, `/audit` — prior shadow evaluation and audit trail.

Business dates are seeded/fixed; documentation must not call them real-time.
NZD money amounts are integer cents in authoritative calculations.

## Evidence needed before the owner does one final review

- [ ] Full CI **on integrated commit**, including exact `format:check`,
      TypeScript, lint, DB tests/migrations, build, evaluator and bundle-secret scan.
- [ ] Smoke navigation for each linked route; test actual seeded/detailed
      records, not only empty pages. Verify no links 404.
- [ ] Reconcile facility, funded and receivables metrics by invoice and
      client; ensure any stale/missing data blocks "drawable" claims.
- [ ] Verify security boundary, user identity and all authorizations. Current
      shared-password demo must **not** be marketed as real MFA/RBAC.
- [x] Authenticated local seeded UI smoke and real 1440px/390px screenshots
      captured by the optional review Actions workflow (#139); its short-lived
      artifact includes the route manifest. Browser execution is not a full
      accessibility or security sign-off.
- [ ] Manual review of the captured screens, keyboard focus, screen-reader
      output and color-contrast checks.
- [ ] Complete a five-case lender calculation/decision review; record owner,
      formula, expected result and actual outcome without self-signoff.
- [ ] Decide product scope: real Xero/Akahu connectivity, payments, and
      complete term/revolver modelling require separate authorized gates.
- [ ] Choose an appropriate free hosting plan and provision a **preview-only**
      database isolated from production, subject to explicit account approval.
- [ ] Finish README with actual screenshots, known gaps, link and 3-minute
      walkthrough. No fabricated link/video.
- [ ] Validate historical replay and synthetic decision after restart.

## Explicit blockers to release-readiness

**The current integrated branch is not production-ready.**

- Offline credit-case assignments and maker/checker transitions now have
  transactional persistence and an immutable event history, but **no verified
  OIDC login, tenant-scoped privileged API, or interactive checker inbox**.
  The visible queue remains read-only; approved transfers are disabled.
- The ingestion journal, retry queue and adapters are not an authorized
  connected scheduled worker. #132's runbook explicitly notes the need to
  fence ingest writes and job completion in a single transaction.
- A client-linked *synthetic* waterfall now reconciles to the dossier and
  invoices (#138), but uses an explicitly hypothetical concentration cap,
  zero scenario reserve and unverified contract/source status. Facility terms
  are current rather than historically versioned; the output is **not**
  authorised drawable credit.
- The memo is not a signed, editable, versioned legal/credit document. Missing
  source facts are intentionally marked absent.
- Product-level visual UAT, provider integration and independent credit/security
  domain sign-off have not occurred.
- Free-tier availability, hosting, environment setup and real demo URLs have
  not been established. Do not interpret local PGlite as hosted durable DB.

## Merge and release controls

Do not merge PR #136 or any earlier PR into `main`; do not enable auto-merge.
Do not run real source reads, publish the prototype as a live lender platform,
charge hosting, provision secrets, or initiate payments without user approval.
The next legitimate status is **synthetic review candidate verified in CI and
UI**, not "production lending system completed."

Issue #135 is the acceptance tracker; do not close it merely because this PR
exists or individual PRs passed.
