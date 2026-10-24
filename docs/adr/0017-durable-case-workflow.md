# ADR-0017 — Atomic case revisions and immutable human decisions

**Status:** Proposed; offline synthetic database contract; #105 / #113.  
**Dependency:** #119 maker-checker state machine, #124 identity-policy kernel.

A credit case is a tenant/client-scoped record linked to a real synthetic
invoice or incident. It has owner, severity, due date, version, maker, checker
and review state. The append-only `credit_case_events` journal records each
transition with actor ID and reason. A database transaction compares the
current version and state, updates the case once, then inserts one immutable
event; on failure the whole transaction rolls back.

**Separation of duties:** the maker cannot approve the same case as checker,
even if their identity carries both roles. Proposed privileged actions require
the pure client-scoped access policy and MFA requirement. The trusted actor is
a **server-internal contract only**, not a verified OIDC session implementation.
Do not call these functions with client-supplied roles, subjects or tenants.

**Important release boundary:** no user-facing case mutation route is added.
The current shared-password demo identity is not independently verified and
cannot execute this privileged workflow. Real authenticated OIDC sessions,
tenant resolution, scheduler/operator assignment, deadline escalation, audit
retention, notification deduplication and full interactive reviewer UAT are
outstanding.

Migration 0005 adds the case table and append-only event history. On upgrade,
run all migrations 0000–0005 in order, including any generated Drizzle schema
snapshot review; do not drop old case data. Tests cover issuer-session policy
boundaries, cross-client source IDs, stale versions, maker-checker separation,
event immutability and database transactional behavior. No funding transfer
is ever invoked by these transitions.

Synthetic integration was authorized on 2026-10-25; live approval APIs remain deferred.
