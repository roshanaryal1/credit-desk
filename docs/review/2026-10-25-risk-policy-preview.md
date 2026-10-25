# Read-only effective-dated risk-policy preview (#101)

The Watch product already has pure approval/effective-date validation in
`lib/watch/policy.ts`. The existing live synthetic Watch runner continues to use
`WATCH_CONFIG` with no behavioural change.

This change adds a distinct **opt-in pure evaluation** function:
`runWatchRulesWithPolicies(book, approvedPolicies)`. It evaluates the same
five detectors on an already dated `Book` with client-specific, independently
approved policy thresholds. Every detection includes `riskPolicyId` and
`riskPolicyEffectiveFrom` provenance. Credit-note detection remains event
driven and does not invent a threshold.

**Fail-closed guarantees**

- A missing effective approved policy for any book client rejects the entire
  preview, rather than silently falling back to shared defaults.
- Duplicate effective-date revisions, invalid UTC approvals and out-of-range
  thresholds are rejected by the existing policy selector.
- Effective versions are selected for the explicit business date and are
  immutable read-only inputs; later revisions do not rewrite earlier results.
- Client A thresholds are never used to evaluate Client B; detection metadata
  matches its client's version.
- Pre-existing `runWatchRules`, ingestion, incident status/history and daily
  persistence remain unchanged. Nothing is sent to external notification
  providers or changes case/incident decisions.

**Not delivered yet**

- Durable versioned policy schema/revision history and verified approver
  identities. These require #109 identity enforcement and a reviewed schema
  migration coordinated with unmerged migration #172.
- Persisting policy IDs alongside incident/day detections, immutable
  notification deduplication, assigned tasks and operational escalation.
- Policy editing UI and a production notification provider.

Tests cover default parity, date switches, missing/ambiguous policy,
cross-client partition, and Auckland daylight-saving boundaries. This is a
safe kernel prerequisite, **not** completion of the whole #101 issue.
