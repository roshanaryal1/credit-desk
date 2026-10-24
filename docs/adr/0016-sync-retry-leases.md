# ADR-0016 — Bounded durable source retries, leases and dead letters

**Status:** Proposed; synthetic and offline only  
**Workstream:** #100, stacked on PR #127, itself stacked on PR #118

## Context

Idempotent import and connection checkpoints survive a process restart, but a
failed or crashed provider poll still needs safely recoverable scheduling.
In-memory timers, unbounded retry loops, or silent retry on corrupted source
events would be inappropriate for a finance application.

## Decision

Maintain a single job per authorised (source kind, connection, client)
partition. Database state is PENDING, LEASED, SUCCEEDED or DEAD.

- Attempts are bounded (1–20), with deterministic exponential retry backoff,
  initially 60 seconds, capped at one hour.
- One atomic SQL UPDATE ... RETURNING grants a lease and increments attempts.
  The lease includes a random, single-use fencing token and expiry. A worker
  cannot complete/fail a job with a stale token, a stale attempt number, or an
  expired lease.
- Expired leases are recoverable. If the last attempt crashed, the reaper marks
  the job DEAD instead of leaving it indefinitely LEASED.
- Permanent source failures (invalid data, consent revocation, conflict)
  reach DEAD without retry. Transient failures are retried when due.
- Store only allowlisted error codes. Never persist raw account numbers, token
  values, provider exception messages, email addresses, or source payloads in
  the job row.
- The scheduler is a **candidate listing** only: lease acquisition remains
  the concurrency boundary, not the order of a SELECT.

## Alternative approaches

- Sleep/retry in a request handler: cannot survive serverless restarts.
- Treat a stale job as successful: loses source freshness provenance.
- Infinite retries: hides consent and validation failures; consumes resources.
- Claim first and rely on a Node mutex: unsafe with more than one worker.

## Limits and next implementation

No live Xero/Akahu API, OAuth refresh, webhook signature verification, secrets
broker, hosted cron, queue trigger, alert delivery, or production-monitoring
integration is added here. This module has no HTTP exposure or automatic
run loop. A future authenticated server-side worker must call it, apply source
ingestion through #127, and explicitly decide whether a provider outage is
transient. Initial restart/requeue policy for SUCCEEDED/DEAD jobs requires
separate operator action and audit approval, not silent overwrite.

## Validation

PGlite/Postgres-compatible integration tests: idempotent enqueue, distinct
client partitions, atomic claim, lease fencing, crash recovery, backoff,
exhausted attempts, dead letter and invalid input. Check migrations in the
ordered #118 → #127 → this PR stack. Synthetic integration was authorized on 2026-10-25.
