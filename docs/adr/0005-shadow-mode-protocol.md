# 0005. Shadow mode: withhold all agent output until the analyst decides

- Status: accepted
- Date: 2026-10-23

## Context

Agreement between the agent and analysts is only meaningful if analysts decide
without seeing the agent's view. Hiding the recommendation alone is not enough:
the explanation and risk level anchor the decision just as much.

## Decision

- In SHADOW mode the server never sends agent output for an invoice before a
  decision on it is saved.
- Exposure is recorded per session and invoice. Only first decisions, made in
  SHADOW, unexposed, and bound to a validated explanation, count toward
  agreement.
- REQUEST_INFO maps to HOLD for agreement and kappa; the confusion matrix keeps
  all four values.
- Simulated decisions form a separate cohort and never mix silently with live
  ones.
- Metrics are descriptive, with sample sizes and intervals. The product makes no
  automation-readiness claims.

## Consequences

Agreement numbers are smaller and slower to accumulate, but defensible. ASSIST
mode stays available for normal work; its decisions are logged but excluded.
