# Credit Desk review: client-specific collateral scenario

**PR:** Draft, depends on unified review PR #136 and finance-domain work #116/#120/#133. **Issues:** #112, #102, #135.

- Adds `/clients/[id]/borrowing-base`, linked from the Client 360 facility section.
- The page uses the **same dated synthetic ledger, receipts, credit notes, debtor IDs and funded position** as Client 360, then passes reconciled integer cents into the audited borrowing-base calculator.
- Stable scenario assumptions are visibly stated: 50% per-debtor concentration cap, exclusion for more than 90 days past due, current seeded contractual advance rate, zero illustrative reserves and outstanding funded advances. It does **not** imply these constitute a real signed finance contract.
- Ledger-to-report reconciliation and cross-client source IDs are tested. If no ledger is available, the UI shows **unknown/unavailable** rather than numeric zero.
- Per-invoice treatment and monetary waterfall link back to the client's dossier. The separate four-invoice `/borrowing-base` demo remains available for independent policy testing.

### Release gates

No provider freshness/knowledge-time proof, dispute/cancellation validation, independent policy approval, real account consent, authenticated tenant identity, actual borrowing-base certificate or bank disbursement controls are included. **These are labelled scenarios, not drawable lending amounts.** Real lender data must be blocked until those gates pass. No commits may merge into main without explicit owner approval.
