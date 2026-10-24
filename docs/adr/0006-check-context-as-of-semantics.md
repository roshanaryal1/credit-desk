# 0006. Check context and submission-date boundaries

- Status: accepted
- Date: 2026-10-23

## Context

SPEC 6 requires checks over a historical snapshot. Some rules say "before"
submission, while others explicitly include submission day. Concentration uses
funded face value, while SPEC 4 defines remaining funding exposure in advance
cents. Ledger status events have no ordering within a calendar day.

## Decision

- Ledger recording, statuses, credit notes, batch submissions, fundings and
  funding adjustments include submission day. Receipt bank dates and debtor
  payment dates must precede submission day.
- SLOW_PAYER uses [submission minus 365 days, submission). NEW_DEBTOR's "no
  payment history" means no prior payment ever, so its context also retains
  one lifetime payment as evidence, even outside the slow-payer window.
- A funded invoice contributes its whole face value while advance minus
  effective adjustments is positive. A zero or negative remainder contributes
  nothing. Concentration deduplicates funded and batch records by invoice ID,
  not invoice number, since submissions with repeated numbers remain distinct
  records and are assessed by DUP.
- Credit-note share and paid coverage use the submitted invoice's face value.
  LEDGER_MISMATCH independently flags any discrepancy with the ledger amount.
  ALREADY_PAID requires at least one allocated receipt, avoiding a vacuous
  zero-amount coverage finding without payment evidence.
- A DUP exemption requires the subject ledger entry's direct supersession
  link and a VOIDED original as of submission. An unrelated void does not
  qualify.
- Missing ledger status remains null. Conflicting statuses on the latest
  effective day cause an explicit error because the schema cannot establish
  which came last.

## Consequences

Check inputs are plain serialisable data with record IDs for evidence and
replay. No business rule uses the wall clock. Calendar-day arithmetic uses UTC
date parts to avoid daylight-saving offsets. Threshold comparisons use integer
cross-products before rounding any displayed share to basis points.

Database tests compare snapshots before and after inserting future events.
If intra-day ledger transitions need support, the schema will need an explicit
ordering field; a status-priority guess would conceal the ambiguity.
