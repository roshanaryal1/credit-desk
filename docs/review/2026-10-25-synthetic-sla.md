# Read-only fictional case SLA insight (#105)

The existing case workboard stores fictional owner, case version and due date.
This PR adds a separate, accessible `/queue/sla` view without changing case
states, identities or data.

- Count business days **after** the case due date, using validated NZ business
  date labels. DST does not add or remove an entire due-date day.
- Default is Monday–Friday only. No unverified NZ public holiday calendar is
  silently assumed. A caller may explicitly inject a validated holiday list.
- Label cases CLOSED, NO_DEADLINE, ON_TRACK, DUE_TODAY,
  NONWORKING_DAY_GRACE, BREACHED and CRITICAL. Approved/held/rejected/closed
  records never become actionable just because the due date has passed.
- Pure code creates an optional deterministic notice *candidate key* based
  on case ID, case version, policy version and escalation stage. This is
  **not a durable notification ledger**; no emails, alerts or tasks are sent.
- Requires a valid policy (thresholds and version) and refuses malformed
  dates, duplicate holidays or inappropriate time spans.
- Access through the existing read-only synthetic case tenant. The borrower
  persona has no staff queue access. Real lending deadlines, security,
  checker approval and enforcement require verified identity (#109).

## Remaining workflow scope

Effective-dated lender-approved SLA policy and authenticated maker/checker
ownership; trusted client/tenant authorization; signed approval workflow;
persisted deduplicated notifications/outbox; lender-specific holiday calendar;
audit retention and incident response. These gates belong to #105/#113/#109
and cannot be satisfied by fictional metadata alone.

No new migration, real borrower data, external notifications, or funding actions.
