# Demo database readiness (read-only)

Before publishing a hosted Credit Desk prototype, verify that the correct
**synthetic-only** database is selected and that its schema and fixture records
actually exist.

```bash
# On an approved operator machine, explicitly choose the disposable database.
# Do not print, commit or share its connection credentials.
npm run demo:preflight -- --target=preview
```

The preflight reads PostgreSQL metadata, a migration-journal existence flag,
row counts, and whether the fictional `cli_0001` borrower fixture is present.
It never runs DDL, DML, payments, live integrations, credential rotations or
account provisioning. A non-zero exit code indicates a missing prerequisite.

A **PRELIMINARY_READY** output is not production certification, confirmation of
synthetic provenance, Vercel environment correctness, or a substitute for human
privacy/financial review.

Remaining #76 checks before a hosted review: explicitly approve the target,
verify the exact deployed Git commit, migrate and seed only an isolated empty
demo branch with owner approval, configure a secured server-side connection,
authenticate in the hosted browser, replay one shadow decision, validate mobile
and desktop screenshots, and record restore evidence. Never point a public demo
at customer financial records. This runbook does not perform these tasks.

For full reproducibility use a disposable local DB with `npm run seed`; GitHub
UI smoke runs against local PGlite, **not** against the hosted Neon branch.
