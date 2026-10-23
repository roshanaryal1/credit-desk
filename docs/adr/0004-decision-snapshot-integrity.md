# 0004. Decision snapshots: canonical JSON, hash chain, append-only

- Status: accepted
- Date: 2026-10-23

## Context

Decision replay must show a past decision exactly as it was made and show that
the stored record has not drifted. Postgres `jsonb` reorders keys and drops
whitespace, so a hash computed before storage cannot be recomputed from a
`jsonb` column. A hash stored next to the data proves nothing against someone
who can rewrite both.

## Decision

- Serialise snapshots as canonical JSON (sorted keys, no insignificant
  whitespace) and store the exact string in a `text` column.
- Store SHA-256 of that string and the previous snapshot's hash (a chain).
- Database triggers reject UPDATE and DELETE on snapshots, explanations, agent
  runs, incident events and audit events.
- Write the decision, snapshot and audit event in one transaction using the
  Neon `Pool` over WebSocket (the HTTP driver cannot run interactive
  transactions).
- The UI says "Checksum matches", not "verified", and states the limits.

## Consequences

Replay renders without touching live data and detects accidental or casual
change. It does not stop a database administrator; production would anchor
hashes externally or use WORM storage.
