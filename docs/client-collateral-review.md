# Client collateral integration

The canonical synthetic review is `/clients/[id]/borrowing-base`.
The alternate `/borrowing-base/clients/[id]` URL redirects there.

Both use `clientBorrowingReview`: dated ledger invoices, allocated receipts,
credit notes and latest effective status. Unknown, conflicting, paid and voided
status excludes collateral. A future status cannot affect an earlier date.
An empty source shows unavailable data instead of drawable credit.

The 50% concentration cap and zero reserves are scenario inputs. These
calculations do not approve credit or initiate transfers. Current facility
terms are not a historical contract archive. Real provider provenance,
underwriting policy and independent approval remain separate work.
