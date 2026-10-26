# Cash reconciliation and captured evidence isolation

Issues #183 and #187.

All selected bank receipts are validated against their entire allocation partition before client, invoice or as-of visibility hides referenced ledger rows. Cash and allocation cents must be nonnegative safe integers; cumulative allocations cannot exceed cash. Every referenced ledger and its debtor must belong to the receipt client. Ownership reads never return foreign record fields to callers. Ageing, client borrowing scenarios, portfolio exports, source-health reconciliation, deterministic check context and agent bank tools use the shared validator.

Cash after the review cutoff is excluded. Same-client future ledger references still consume the selected receipt's cash budget for internal validation. Because allocation rows lack their own observation timestamp, the agent tool fails closed for any selected receipt linked to an as-of-invisible ledger, rather than exposing its IDs or contribution to an aggregate. A malformed or temporally unproven receipt aborts the bank tool before any receipt evidence is registered. Tools return a generic reconciliation error.

New evidence captures use `captured-evidence-v2`. Visible allocations retain original ledger ownership and business dates, alongside the allocated cash total, which must exactly equal the visible, individually proven allocations. Capture verification checks that original proof without reading modern source rows. Existing v1 captures are not rewritten: empty allocation lists remain verifiable; nonempty lists without original ownership proof fail closed. Historical manifests and decision snapshots retain their original contents and checksums. No database migration or provider calls are required.

The context fixture's deliberately forged cross-client receipt was removed from its valid historical-replay baseline and replaced with explicit rejection coverage in `tests/data/receipt-reconciliation.test.ts`.

This correction does not establish live provider completeness, authenticated tenancy, or a serializable read snapshot across independently queried screens. Those remain programme release gates.
