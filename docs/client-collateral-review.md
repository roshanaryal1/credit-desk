# Client-specific collateral reconciliation — proposed

Issue #112 / #102 / #111; based on the integrated draft PR #136.

This integration introduces the **read-only synthetic client borrowing-base
preview** at `/borrowing-base/clients/[id]`, linked from Client 360.

The original standalone `/borrowing-base` four-invoice example remains
unchanged for reproducing independent hand-calculated finance tests.

### How the new preview derives its figures

- Inputs come from client-scoped recorded ledger invoices, dated bank receipt
  allocations and effective-dated credit notes. It shares the underlying
  receivables-ageing read model used in Client 360.
- It reads latest effective ledger status no later than the as-of business
  date. Missing status, conflicting same-date status, paid/voided status and
  receivables over 90 days past due are excluded from eligible collateral.
- Net receivables are reconciled to ageing, then passed into the pure,
  tested borrowing-base calculation. Existing funded principal is obtained
  from the client dossier's date-scoped funding and adjustment ledger.
- The 50% debtor concentration cap and **zero sandbox reserve assumption**
  are explicitly **proposed demonstration parameters**, not legal facility
  terms. The current client advance rate and commitment are from the
  synthetic fixture, and may not represent historical amendments.
- No claim is made that the numeric calculation is **drawable funding**.
  The return type always says `NOT_VERIFIED_FOR_DRAWING`, and the page
  visibly lists lender sign-off, data provenance and dual-control blockers.

### Fail-closed rules

- Clients cannot see other client partitions in the source ledger read model.
- Missing or contradictory ledger statuses exclude the entire residual
  receivable; no silent assumption of authorisation.
- Recorded receipt/credit amounts must reconcile to outstanding balances.
- Empty source data and zero balances are not proof of an actual verified
  zero balance. The current shared-password access is synthetic only.

### What still prevents operational use

A real provider observed-at journal, signed underwriting policy, approved
eligibility exclusions and reserves, verified contract terms, authenticated
OIDC/RBAC, lender SME tests, advance commitments and human dual approval.
No live provider connection, payment rail or case approval is enabled by
this PR. End-to-end browser/mobile UAT and domain sign-off are outstanding.

This PR is a separate **draft** off the review branch. Integrate code by
reviewed snapshot only and re-run the full review-branch CI. Never merge
any PR to main until the owner explicitly lifts the freeze.
