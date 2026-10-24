# Runbook — synthetic source-ingestion recovery

**Status:** Draft / pre-production. References: #100, #106, PRs #118, #127, #132.  
**Do not execute against real customer accounts without identity, provider
consent, security review and operational sign-off.**

## What this protects

The source-event journal and checkpoints in #127 are durable. This change adds
a persistent per-connection sync job with a bounded retry attempt count and a
short-lived lease. A worker may crash at any step; the next worker must not
pretend the import succeeded or replay a conflicting fact unnoticed.

## Status transitions

- **PENDING:** work is due at `next_attempt_at`; safe to list as a candidate.
- **LEASED:** a worker owns the job until `lease_until`; only that lease
  token/attempt may complete or record failure.
- **SUCCEEDED:** the job finished this controlled one-shot import; no implied
  perpetual monitoring is scheduled.
- **DEAD:** all attempts were consumed, an expired final lease was reaped, or
  a permanent data/consent error occurred. **Do not silently auto-reset.**

An empty set of due jobs is not proof that sources are fresh. Reconcile it
against the ingestion checkpoint's last successful sync, source health and the
client's approved data-refresh SLO.

## Operator checklist

1. Identify the client/connection partition and its source kind.
2. Inspect the sync job state, attempt count, last allowlisted error code and
   `last_failure_at`/last successful checkpoint. Never copy a raw provider
   exception with account numbers, tokens or customer data into issue comments.
3. Compare the source-event journal against imported invoice/receipt counts and
   the provider's sandbox cursor. Do not treat incomplete data as zero.
4. For `TIMEOUT`, `NETWORK`, `PROVIDER_DOWN` or `RATE_LIMIT`, let the
   bounded retry cadence run after verifying provider health.
5. For `INVALID_DATA` or `CONFLICT`, investigate duplicate source IDs,
   effective/observed dates, field validation and revisions. Fix the mapping,
   **not** the immutable recorded facts.
6. For `REVOKED_CONSENT`, disable polling until the account holder explicitly
   restores valid consent. Never work around provider revocation.
7. After exhausted retries, preserve the DEAD job as an audit artifact. A
   supervised new-generation retry with operator attribution and reason must
   be designed and approved separately.
8. Record root cause, records affected, system as-of date, recovery action,
   replay evidence and client-facing consequence, where applicable.

## Crash/race scenarios

| Scenario | Correct observed behavior |
| --- | --- |
| Two pollers list the same due job | Only one acquires the atomic lease |
| Worker pauses beyond its lease | Another worker may reclaim it |
| Paused worker resumes | Old token cannot complete or fail the reclaimed job |
| Final allowed attempt crashes | Reaper marks it DEAD instead of leaving it locked |
| Retryable provider timeout | Requeue with 1, 2, 4, … minute backoff, cap 60 min |
| Revoked authorization | Immediate DEAD; do not retry until separately approved |
| Contradictory provider event replay | Import transaction fails; immutable history remains |
| Job row appears SUCCEEDED but source is stale | Investigate data freshness; completion alone is insufficient |

## Trust boundaries and gaps

The implementation is only a library, migrations and PGlite/Postgres tests;
it has **no live scheduled worker, alerts, host process watchdog, operator UI,
notification service, key vault, real Xero/Akahu credentials, or payment
integration**. The exported library functions must only be invoked from a
trusted server-side context. Job names/IDs are scoped references; do not add
raw customer payloads, private data or provider bearer tokens.

Workers that persist source data must call `persistClaimedSourceBatch`.
It fences the token, attempt, connection and expiry, then commits the source
journal, checkpoint and completion in one transaction. A rejected import rolls
back completion too. Do not split data writes and acknowledgement across calls.
`completeSyncJob` is only an acknowledgement for jobs without source writes.

## Readiness criteria

- [x] Lease and retry DB tests pass on the exact migration stack.
- [x] Migration snapshots 0003 through 0005 are generated and match the schema.
- [x] Atomic, lease-fenced data-write/acknowledgement path is implemented and tested.
- [ ] Production OIDC authorization and tenant isolation enforced for scheduler.
- [ ] Provider sandbox pagination, rate limits, OAuth rotation and consent reviewed.
- [ ] Monitoring, backup/restore, recovery drill and end-to-end operator UAT passed.
- [ ] Independent credit/security sign-off and release permission recorded.

The owner authorized merging the corrected synthetic prototype on 2026-10-25.
Real feeds still require the separate readiness checks above.
