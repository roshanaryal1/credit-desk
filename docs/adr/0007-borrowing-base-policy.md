# ADR-0007: Deterministic borrowing-base calculation (proposed)

Status: **Proposed — requires independent credit-domain review**  
Issue: #102; product view #112

## Context
The v1 `fundableCents` function computes advances on approved invoices and applies simple facility headroom. Actual invoice finance availability also depends on receivable eligibility, credit notes, collections, concentration, reserves, sublimits and existing drawings. Pretending all face value is available would mislead analysts.

## Decision proposed
Introduce a separate, pure `lib/credit/borrowing-base.ts` module. It accepts a validated *as-of snapshot* and a versioned policy. No DB writes, LLM calls or funding execution.

1. For each invoice, **net = face − allocated receipts − credit notes**. The importer must reconcile original financial events and avoid allocations being counted twice. Throw if deductions exceed face.
2. Ineligible invoices contribute **zero** to the eligible pool; preserve reasons and net amount in the treatment report.
3. **Debtor concentration cap** is applied to each debtor's eligible net amount against the *pre-concentration* eligible pool. Stable invoice ID sorting makes the haircut traceable. Whether this cap formula matches a particular lender's agreement must be reviewed.
4. Multiply each capped-eligible invoice by the advance rate in basis points, floor cents per invoice, and sum.
5. Deduct reserves **after** the advance. Available amount is the non-negative minimum of (secured collateral value less already drawn), facility commitment headroom, and optional sublimit headroom.
6. Report all intermediate totals, overdrawn amounts and per-invoice adjustments with a policy version and business date. Insufficient/inconsistent input raises an error, not zero availability.

## Constraints
- This is not an approved legal lending formula. Facility-specific thresholds and policy precedence require lending SME sign-off.
- A source adapter supplies the historical as-of snapshot, including data freshness; this module does **not** decide whether a source is current enough.
- No use of JavaScript decimal currency arithmetic; use non-negative safe integer cents and bounded basis points, with checked sums.
- No credit decisions are made by AI. An authorised person must review any draft result.
- No UI is connected in this PR; issue #112 owns the analyst-facing waterfall.

## Rejected alternatives
- Reuse `fundableCents` unchanged: insufficient eligibility and reserves.
- Let an LLM estimate availability: nondeterministic and un-auditable.
- Aggregate-first advance rounding: differs from per-invoice contractual rounding.

## Evidence and rollout
Tests include hand-calculated examples, order independence, duplicate detection, invalid dates/amounts, reserve/sublimit precedence and cent-rounding. Integrate with real snapshots only after #100/#103 reconciliation contracts and policy approval. Until then, use synthetic fixtures only.
