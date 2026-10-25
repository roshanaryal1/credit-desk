# Synthetic ingestion operations monitoring (issue #100)

This slice adds an **inspection-only** ingestion workbench at
`/operations/sources` for lender/analyst/checker/auditor demo perspectives.
The fictional borrower cannot navigate to it. It uses existing
`ingestion_sync_jobs` and `ingestion_checkpoints` tables; it neither claims a
job nor reads raw provider payloads.

## Detection semantics

The UI shows a fixed simulation reference UTC instant derived from
`DEMO_TODAY`. It distinguishes queued, retry-due, retry-wait,
in-progress, expired lease, successful and dead-letter jobs. It also
separately classifies source freshness as FRESH/STALE/ERROR/UNKNOWN using
the existing observation validator.

Missing checkpoints remain UNKNOWN; future checkpoints are not read as
historical successes (exception `FUTURE_CHECKPOINT`). Errors surface only
pre-approved coarse error codes, not provider exception strings. Job IDs
and lease tokens never appear in the read model or UI. Multi-client
source identities are namespaced and validated. The UI cannot retry,
requeue, approve, configure credentials or dispatch funding.

The job/checkpoint tables are mutable; they are **not a reconstructible
event-sourced history**. An injected reference time is a simulated
diagnostic comparison, not proof those mutable rows existed then.

## Remaining issue #100 acceptance work

- Authenticated tenant-specific operator identities and controls (#109).
- Actual recurring worker deployment, health probes, alert delivery, runbooks,
  supervised dead-letter recovery, retention/restore tests.
- Provider-neutral full contracts for invoices, statuses, credit notes,
  receipts, debtor history, and actual consented provider connectors (#106).
- End-to-end late-arrival and partial-outage fixture reconciliation, historical
  knowledge cutoffs for legacy source data.
- Reconciliation/monitoring with the as-of source workbench in PR #170.

This is one bounded capability of #100, **not entire issue completion**.
Independent PR integration review and end-to-end tests remain required
before any deployment. No real sources or migrations used.
