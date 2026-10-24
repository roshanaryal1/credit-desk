# ADR-0015 — Closed-loop funding intents (proposed)

Issue #107; stacked on draft security foundation PR #124.

The delivered pure simulation code accepts **synthetic, source-referenced** facility availability and constructs a review intent for a verified (in a future trusted session) analyst. A distinct MFA-verified checker may approve or reject, and the approving checker can move the simulation to a clearly marked *simulated settled* state. No bank transfer, external HTTP request, live availability claim, accounting ledger change or payment instruction exists.

The security policy imported from #124 prohibits `FUNDING_EXECUTE`; these case transitions use separate simulation-only statuses. All idempotency/race guarantees must be enforced in a durable database transaction later (optimistic compare-and-swap, one immutable event per transition, debit/reserve reconciliation), not by this pure function.

Before any real payment integration: verified user sessions, maker-checker workflow persistence, authoritative borrowing-base data, dual control and bank/payments partner sign-off, independent pen test, reconciliation runbooks and privacy/legal review. Leave a real payment path disabled until those explicit approvals.
