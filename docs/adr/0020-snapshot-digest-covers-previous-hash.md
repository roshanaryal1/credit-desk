# 0020. Snapshot digest covers the previous hash

- Status: accepted
- Date: 2026-11-27
- Amends: [0004](0004-decision-snapshot-integrity.md)

## Context

ADR 0004 stored each snapshot's SHA-256 and, beside it, the previous
snapshot's hash. The previous hash was not inside the hashed content
(`hashSnapshot` computed `SHA256(canonicalJson)`). Someone who can write to the
database could therefore rewrite snapshot N with a recomputed hash and repoint
N+1's `prev_sha256` at it, and `verifySnapshot` stayed green for both rows.
The "chain" did not chain (#233, launch audit finding D1).

Two smaller gaps sat next to it: `chainHead` sorted `decision_snapshots` by
`created_at` with no index on every decision (D3), and nothing in the database
stopped two snapshots from naming the same predecessor.

## Decision

- Schema version 5. A snapshot's stored `sha256` is
  `SHA256("v5\n" + prev_sha256 + "\n" + canonical_json)`, with an empty string
  for the first snapshot. The previous hash is 64 hex characters or empty, so
  the framing cannot be confused.
- Rows with schema version 1 to 4 keep their original rule
  (`SHA256(canonical_json)`), so existing history still verifies without a
  rewrite.
- `verifyChain` walks every snapshot in insertion order, checking each digest
  and each link, and reports the first break and its kind (`CHECKSUM` or
  `LINK`). It pages by `(created_at, decision_id)`.
- Migration 0008 adds `UNIQUE NULLS NOT DISTINCT (prev_sha256)`, so the chain
  has one genesis and every snapshot has at most one successor, and an index on
  `(created_at, decision_id)` for `chainHead` and `verifyChain`.

## Consequences

Rewriting a snapshot now breaks its successor's digest, and an attacker who
wants a consistent forgery has to recompute every later snapshot. That is
still possible for someone with full write access, because the digests are not
keyed and nothing outside the database records the head. ADR 0004's limit
stands in a narrower form: production would anchor a signed head digest
outside the database (for example daily), which is the remaining part of
#233's plan and not done here.

The migration fails if existing data already contains a fork (two rows with
the same `prev_sha256`, or more than one genesis). The global decision lock
makes that unlikely; if it happens, the data needs investigating, not the
constraint removing.
