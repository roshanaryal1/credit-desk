# Synthetic case workboard (#105 / #113)

The operational triage queue remains unchanged and read-only. This slice adds
a separately labelled, database-backed read-only workboard that displays
persisted synthetic credit-case owner, priority, deadline, revision and state.

The local or approved synthetic-only seed script creates exactly five
fictional case examples linked to genuinely generated flagged invoices.
Their initial states demonstrate NEW, ASSIGNED, IN_REVIEW, CHECKER_REVIEW and
RETURNED. Each has a plainly marked synthetic fixture event. They are not
authenticated human case actions, policy-authorized approvals, or a historical
record of actual risk decisions.

Filters: All cases, Unassigned, Checker inbox, Overdue. Overdue means due date
before the fixed simulated demo business date and a non-final state. It is not
a contractual SLA or regulatory holiday calendar.

All queries are pinned to the disposable fictional tenant marker. This is a
demo data partition, not OIDC-backed authorization. There is no claim that a
visitor choosing Checker has verified approval rights.

Outstanding #105/#113: identity-bound transactional case actions and actor
authorization; genuinely independent maker/checker; tenant/client permissions
and rate limits; staff ownership/assignment flows; notification deduplication;
business-day SLAs; audit replay, larger scale/pagination and accessibility UAT.

No release, production seeding, real funding or provider integration is
performed by this PR.
