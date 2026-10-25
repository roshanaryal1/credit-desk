# Client collections pulse (#104)

The existing client collections page exposes dated debtor-level observations.
This change adds a **read-only, deterministic** portfolio summary built from
the *same* source-backed `getClientReceivablesAgeing` query results.

- Reconciles client outstanding and overdue totals against every debtor row.
- Sums prior and current 30-day arrears, receipts and credits separately.
- Identifies largest debtor receivable concentration using integer-cents and
  exact integer basis-point arithmetic; includes the contributing dated ledger
  invoice IDs.
- Surfaces existing descriptive payment/credit/arrears signals with stable
  debtor, invoice and source references; no LLM ranking or invented risk score.
- Explicitly reports unknowns when no ledger sources are recorded, rather than
  promoting synthetic database zeros to verified real-world zeros.
- Refuses mismatched debtor collections records, overflows, invalid dated
  totals, repeated debtor IDs and inconsistent arrears movements.

This is **not** a predictive credit rating, approved policy, verified DSO or
money movement. Source knowledge-time provenance, debt write-offs, amended
terms and full live accounting reconciliation remain separate tracked gaps
(#100, #102, #104, #106). No DB migrations or other users' account data.
