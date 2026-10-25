# Synthetic evidence checklist (#162)

The read-only case workboard, unsigned credit memo and fictional borrower
perspective use the same dated, client-scoped evidence requirement model.

- Stable requirement IDs use `caseId:requirementKind`; no external document
  identifiers or customer uploads are stored.
- A submitted invoice requirement is RECEIVED **only** if its existing invoice
  is in a client-scoped dated batch. That status means the seed contains an
  invoice record; it is not evidence of borrower identity or authenticity.
- BANK_CONFIRMATION remains MISSING without real bank proof. An intentionally
  EXPIRED `case_synthetic_01` debtor-consent item is fictional metadata, not
  a real consent record. Other cases can be NOT_REQUIRED by the seeded
  illustrative workflow, never a lender-approved policy.
- Due today/overdue/upcoming derives from `DEMO_TODAY` or an explicit as-of
  date, never local wall-clock time. Missing due dates remain unknown.
- The borrower perspective queries only `DEMO_CLIENT_ID`, displays outstanding
  missing/expired metadata, and has no update/upload/approval action. The
  lender case and memo views show their own scoped requirements; the memo
  download includes the same current checklist, explicitly unsigned.
- The synthetic fixture records are intentionally **derived**, not a persisted
  authorized document-management system; persistence, independent
  verification, notifications and privileged checker actions remain gated
  by #105/#109/#113.

No schema migration, real source, external document, phone/email notification,
disbursement, or financial policy modification is included.

Acceptance: exact-head typecheck, lint, Prettier, full tests, build,
CI synthetic browser routes on desktop/mobile, and client-isolation review.
