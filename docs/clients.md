# Client relationship dossier (proposed v2)

Issue #103 / #111. This delivery uses the existing synthetic v1 data model.

- `/clients` lists client facilities and current outstanding amounts.
- `/clients/[id]` shows committed exposure, funded outstanding, a per-debtor breakdown, submitted invoice batches and risk incidents with drilldowns.
- Read models use client ID scope on all primary queries and a validated as-of business date. Fundings and adjustments are filtered by date. Amounts reconcile to invoice-level funded positions.
- **Not yet production-ready:** the prototype shared password is not a verified tenant-aware identity; no real customer data may be used. Facility terms have no amendment history, so the as-of position does not include historical policy revisions.
- **Not mislabelled:** submitted face value is distinct from outstanding receivables; facility headroom is not drawable/borrowing-base availability. Documents, ledger reconciliation, repayments, read isolation and source freshness require follow-on work #100, #102, #104 and #109.
- This is a stacked PR based on #117 (visual shell); no merge and no claim of full Client 360 acceptance yet.
