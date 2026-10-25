# Synthetic source-health and reconciliation (#160)

The Client 360 dossier links to `/clients/[id]/source-health`; the collateral
page also links to this workbench. This read-only view uses an **injected**
`DEMO_TODAY` cutoff; it does not trust wall-clock time.

- Source journal checkpoint status is UNKNOWN, FRESH, STALE or ERROR using
  the existing `sourceHealth` engine. It scopes each checkpoint and accepted
  dated observation to the client, connection, business date and UTC cutoff.
  Historical views never read future checkpoint success/failure timestamps.
- Synthetic bank records are counted **once** each and split into allocated
  and unmatched portions. Partially allocated bank receipts remain PARTIAL.
  Dated credit notes are shown separately rather than counted as bank cash.
  For consistency, linked ledger rows must exist as of the selected date.
- Missing source or absent bank rows never assert verified zero. Accepted
  checkpoint freshness is **fictional** and does not confirm consented
  Xero/Akahu source accuracy. Legacy ledger and bank rows have no independent
  observation timestamp and cannot be treated as historical provider proof.
- Invalid dates, negative/unsafe monetary amounts, over-allocated cash and
  cross-client result contamination must fail closed.

This is the bounded read-only UI child of #100/#111. Operator worker,
provider source integrations, retention and regulated credit-policy
reconciliation remain out of scope. No database migration, auth changes,
external requests, notifications or funding actions.

Release gates: verify exactly the latest PR head with lint, Prettier,
typecheck, synthetic read-model tests, end-to-end 390px desktop/mobile
routes and production build. Real provider trust requires #106 and #109.
