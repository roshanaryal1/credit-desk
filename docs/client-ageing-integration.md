# Client 360 — receivables ageing integration (proposed)

**Issues:** #111, #104, #103. Stacked design/review dependencies:
#117 → #122 → #125 → this PR, and independently #120 debtor-ageing core.

This PR connects the deterministic debtor-ageing function to **synthetic
PostgreSQL ledger and bank-allocation records**:

- Scoped ledger-entry reads use the requested client ID, issue and recorded
  business dates; receipts map through client-scoped bank transactions and
  effective bank dates. Credits use their source effective date.
- Unknown/cross-client debtor or bank mappings fail closed instead of quietly
  producing understated receivables.
- A ledger invoice amount is not the funded principal amount. The dossier
  therefore labels *receivables ageing* separately from *funded exposure*
  and the still-unverified *borrowing-base availability*.
- Open invoice evidence appears in accessible, expandable table rows.
- Source dates and due dates are explicit, with **due dates estimated from
  current demo payment terms**, not real contracts.
- Reconciliation tests use a two-client synthetic fixture with backdated
  allocations, late receipts, credit notes, cross-client records, and
  golden ledger totals.

## Known limits and release dependencies

The v1 synthetic ledger does not include authoritative historical
facility-policy revisions or provider observation timestamps for every
record. Consequently, these historic views are date-scoped but **not**
a complete real-world knowledge-time reconstruction. No bank/API account
was connected or queried. The shared-password prototype is not a
tenant-authenticated enterprise environment.

Before live use: reconcile the #100 event journal with proper source-of-truth
revisions, verify contract-specific due dates, obtain consent/security approval
for external connections, enforce G10 identity/authorization on all queries,
and perform UAT including mobile/keyboard interaction.

### Stacked branch rule

This branch copies the pure #120 debtor-ageing module into its isolated
integration branch for CI and review. It is **not** a second source of truth:
before eventual integration, rebase onto the accepted #120 commit and drop
the duplicate file from this PR's diff. No PR is merged under the current
owner-requested freeze.
