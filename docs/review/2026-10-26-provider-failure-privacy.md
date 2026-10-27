# Provider failure privacy

Issue #188.

Provider exceptions can contain request bodies, credentials or upstream response content. The agent runner now classifies failures privately and returns stable messages. Recovery prompts use constant instructions. Structured logs retain a safe error code and count instead of exception text, provider metadata or validation details.

Deadline handling, the single schema-recovery attempt and non-Error failures have regression coverage. Synthetic private markers are checked against returned outcomes, captured logs, stored diagnostics and retry messages. No real credentials or provider calls are used by these tests.

This change does not anonymize record-linked run IDs, rewrite historical diagnostics or establish a general application logging policy. No database migration or deployment environment change is required.
