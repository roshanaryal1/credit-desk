# ADR-0011 — Versioned watch thresholds and escalation (proposed)

Issue #101. The initial domain module does not change existing Watch defaults, write incident events, or dispatch alerts.

Policy versions are scoped to one client and have explicit effective-from business date and independent reviewer approval instant. A selection for a historical date returns the version that was in effect then. Duplicate effective-date policies fail closed. Rules can request a threshold only if it exists; credit-note detection is event-driven and has no invented numeric threshold.

Acknowledgement does not erase a currently unresolved escalation. Resolved incidents have no active escalation. All calculations use whole calendar days and validate the as-of date. Later work requires durable versioned policy storage with tamper-proof approvals, recurring jobs, escalation ownership and SLA-notification idempotency, authenticated role enforcement (#109), and a risk trend dashboard (#110).

This is synthetic-only behaviour pending underwriting sign-off and full #101 implementation. No risk predictions, automatic lending or real notification delivery.

## Historical incident event visibility

The Watch as-of date is an NZ-local business date. Incident status and action history must include only events whose UTC instant maps to that day or earlier in Pacific/Auckland. This prevents later acknowledgements, resolutions and reopens from leaking into previous snapshots, including across daylight-saving changes. This is a read-model correction only; it does not change append-only records or authorise policy edits. Tracked in #101.
