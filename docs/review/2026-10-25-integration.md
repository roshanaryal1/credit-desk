# Synthetic prototype integration verification

The owner authorized fixing and merging the remaining PRs on 2026-10-25.
The scope is the synthetic prototype described in SPEC section 14. This does
not authorize deployment, real provider access, customer data or payments.

## Corrections

- Deny non-finite session expiry and explicitly empty client grants.
- Use Pacific/Auckland policy dates, reject malformed approval instants and
  prevent escalation with a policy that is not yet effective.
- Exclude future-issued provider invoices and reject contradictory versions
  at the same effective date.
- Keep ingestion checkpoints monotonic. Fence the source journal, checkpoint
  and sync completion in one transaction, with rollback and stale-worker tests.
- Use one status-aware client collateral calculation and one canonical page.
  Paid, voided, unknown and conflicting statuses exclude balances; future
  statuses are ignored until effective. The alternate URL redirects.
- Check the committed browser script without rewriting it in CI. Run browser
  CI for application, component and domain changes too.
- Correct definition-list markup, inline-link distinction, skip-link focus
  and keyboard access to horizontally scrolling finance tables.
- Generate migration snapshots 0003 through 0005 and declare the SQL checks
  in the schema. The generator reports zero drift. SQL migrations are unchanged.

## Evidence

- Type checking, lint and exact formatting pass. Five existing unused-argument
  warnings remain in provider stubs.
- All 295 tests pass, including an upgrade from the v1 migration journal that
  preserves existing records and append-only protection.
- Production build passes with the documented Webpack option. Local Turbopack
  encountered process/port sandbox restrictions; remote CI uses the normal build.
- Client bundle secret scan and synthetic evaluation pass.
- Desktop 1440px and mobile 390px routes render without browser exceptions or
  document overflow. Automated WCAG A/AA checks report zero violations on
  the reviewed routes; dark-mode core pages also pass. This is not a claim of
  comprehensive accessibility certification.
- Keyboard checks confirm skip-to-main focus and table scrolling.
- Independent domain review reports no remaining findings. Source inventory
  confirms every remaining PR file is represented by its snapshot or a later
  corrected implementation. Original histories are reconciled through PR #136
  so older snapshots do not overwrite fixes.

The localhost database was not reseeded. Authenticated production smoke uses
a separate disposable database. Final GitHub CI must pass before merge.

## Remaining product work

Verified enterprise identity and privileged APIs, live provider consent,
independent lender policy approval, signed memo revisions and deployment are
future work. Queue and memo pages remain read-only review experiences. Parent
feature issues must not be closed as production-complete by this integration.
