# 0002. Deterministic rules detect, the LLM only explains

- Status: accepted
- Date: 2026-10-23

## Context

Funding decisions need checks that are testable, repeatable and auditable.
LLM output can be fluent and wrong, including invented amounts or records.

## Decision

- Every risk flag comes from a pure, unit-tested check function in
  `lib/checks/`, with thresholds in one config file.
- The LLM agent runs only on flagged invoices and High incidents, uses read-only tools and writes
  a structured finding that cites record ids.
- A validator rejects any finding that cites a record that does not exist,
  belongs to another client, or states an amount not present in the cited
  records. One retry with the errors, then `validation_status = failed`.
- The agent never approves or funds. An analyst makes every decision.

## Consequences

Detection quality is measured with precision and recall against labels,
independent of the model. Explanation quality is measured separately
(citation validity, amount faithfulness, schema pass rate). The model can be
swapped without changing what gets flagged.
