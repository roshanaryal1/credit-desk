# ADR-0010: As-of receivables ageing and collections trend

Status: **Proposed, synthetic core only**  
Issue: #104; client experience #111.

## Definition
Calculate ageing from **outstanding receivable balance**, not invoice face and not the funded advance amount:

`outstanding = face - receipts allocated by as-of - effective credit notes by as-of`.

Issued-after-as-of invoices are invisible. Age is the number of whole calendar days the as-of business date follows the due business date. On/before due date is current; otherwise ageing bands are 1–30, 31–60, 61–90 and 90+ days (where 90+ means **91 or more** to avoid overlapping with 61–90).

A partial payment reduces only the outstanding balance; it does not change due date or retroactively classify an earlier as-of snapshot. Receipts and credit notes have independent effective dates. Invoice IDs are unique in each snapshot; source allocation IDs cannot be repeated within an invoice. Reject negative or unsafe integers and aggregate deductions exceeding face.

Trend reference periods are the most recent 30 calendar days including as-of, then the preceding 30 days. These are **receipt amounts** and not a stand-in for probability of default, DSO or credit rating.

## Caveats / follow-ons
- This standalone calculator has no live bank feed, durable historical knowledge cutoff or ingestion quality assertion. Those belong to #100 and #106.
- The borrower/credit team must approve the actual contract terms, dispute/write-off treatments and whether days past due use calendar or business days.
- An ageing result is **not** a bank-grade credit score and is not an authorization to lend.
- Next step: connect the reconciled result to Client 360 and the workbench, with source IDs and complete client isolation.
- No actual collections workflows or AI model calls are made here.

## Validation
Independent tests cover partial receipts, dated credit notes, excluded future events, full bucket boundaries, deterministic ordering, duplicate allocations and impossible balances.
