# Synthetic follow-up review, 26 October 2026

This release combines reviewed PRs #167 through #177 with corrective review
changes. It builds on the captioned walkthrough in #165. All demonstration
records and self-selected personas remain fictional.

## Delivered behavior

- Client source health and cash-allocation reconciliation use a New Zealand
  business-day cutoff and reject foreign, negative or excessive allocations.
- Client borrowing-base scenarios reuse one dated source snapshot and preserve
  original invoice facts. Invalid inputs fail at the server boundary.
- Fictional case evidence requirements show missing and expired items, exact
  same-client invoice links, and unsigned memo export metadata.
- Deterministic portfolio Markdown exports include scope, evidence references,
  source gaps and a reproducible SHA-256 digest.
- Read-only ingestion operations, client collections risk, case SLA summaries
  and effective-dated Watch rule previews expose synthetic monitoring state.
- Agent runs retain immutable original tool records. Validation binds the
  capture to its actual subject, client, date, tool sequence and typed records.
  Invoice and Watch citations and new schema-3 decision snapshots preserve
  original captured evidence separately from current deterministic inputs.
- Private review exposure is recorded for decision revisions. Historical flags
  are reported as recorded values rather than proof of an unseen explanation.
- Every demo role has visible account, switch-role and sign-out controls.
  Hidden login pages retained by Next Activity no longer hide the workspace.

## Verification

Passed: 447 tests across 67 files, types, lint, formatting, standard Turbopack
build, client bundle scan and synthetic evaluation. Lint retains
seven existing warnings. A clean install reports zero audit findings after a
scoped esbuild override for the migration tooling. Official Drizzle generation
produces no schema differences.

The isolated production browser run covers all review routes at 1440px and
390px, five public role sessions, keyboard role switching and sign-out, cookie
clearing, protected navigation, borrower restrictions and public write denials.
It also checks scenario source preservation, exact maximum integer-cent
formatting, invalid inputs, reset, memo export and private/client-filtered
portfolio digests. All 52 route/persona checks passed. The 26 targeted axe checks across 13
screens at both widths reported zero violations.
Physical handset testing and full accessibility certification are not claimed.

## Deployment order and data preservation

Migration 0006 adds an append-only evidence-manifest table and a false-by-default
flag on existing agent runs. It does not backfill original tool provenance or
change historical snapshots. Apply it before releasing the new application.

The generated migration was exercised on an isolated Neon branch cloned from
the synthetic database: all 189 snapshots and 68 runs retained identical
fingerprints, other row counts were preserved, and seven migration records
exist. An attempted manifest update was rejected by the append-only trigger;
all temporary test rows were rolled back using a savepoint.

Hosted deployment verification follows main-branch CI. The canonical URL is
https://creditdesk.roshanaryal.com. Release status is tracked in issue #135.

## Remaining boundaries

Legacy runs without original manifests stay explicitly reconstructed; they are
not presented as original provenance. Hashes and database triggers do not prove
provider authenticity or prevent a privileged database rewrite. Existing
historical snapshots are unchanged.

Operational screens remain read-only. Verified enterprise identity/MFA,
live-provider consent, approval execution, notifications, money movement and
credit-policy/security/privacy sign-off remain separate programme gates in
issues #99 and #135. These features do not authorize real lending.
