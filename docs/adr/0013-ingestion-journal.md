# ADR-0013: Durable source journal and atomic checkpoints (proposed)

**Dependency:** Source contracts in draft PR #118. Synthetic integration was authorized on 2026-10-25.

## Decision
PostgreSQL stores an append-only ingestion journal, uniquely keyed by provider kind, connection, client and provider event ID, and a mutable connection checkpoint. Successful record ingestion and checkpoint advancement happen in one database transaction. Duplicate event replay is harmless, whereas conflicting duplicate content raises an error and rolls back the batch. Received events are visible historically only after both their effective date and first-observed UTC instant.

A sync failure can update failure telemetry without erasing its last known successful checkpoint or cursor. The database itself forbids UPDATE/DELETE on immutable event records. All tests use PGlite with the same SQL migrations as the production Postgres target.

## Safety limitations
No external API access or tokens, scheduling, retry/backoff, dead letters, provider pagination, webhook verification, credential/consent management, encryption-at-rest policy, verified tenant auth or production release yet. Generated snapshots 0003 through 0005 match the integrated schema; an upgrade test preserves v1 records and append-only protection. Use this only with synthetic demo inputs until #109 security and #106 consent approvals.

## Rollout and rollback
Apply migration 0003 before invoking ingestion persistence; preserve earlier append-only events on future migrations. Roll back application entry points before database changes, and do not drop historical source events. A rejected conflicting event is an operational incident for a future dead-letter queue, not a reason to force overwrite data.
