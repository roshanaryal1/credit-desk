# Synthetic portfolio review pack (#163)

The workbench download opens `/portfolio/export?asOf=YYYY-MM-DD`, with
optional `&client=cli_0001` to restrict the file to a single fictional client.
It returns Markdown as a private, non-cached attachment.

- Uses the **same dated client dossier and receivables/collections read models**
  as Client 360 and the collections screens, plus the dated incident query.
- Reports funded principal, commitment headroom, ledger receivables and overdue
  buckets as **different** measures. Headroom is *not* drawable funding.
- For each client, lists outstanding risk exceptions, receipts and credits
  by period, source IDs and drill-down links. Missing accounting/bank proof is
  explicitly UNKNOWN and never silently replaced with a verified zero.
- Each report includes its business date, scope, configuration version and
  fictional-only disclaimer; its content digest is deterministic. The generator
  is a pure renderer with no clock, agent calls, mutations or payment actions.
- Public demonstration visitors may download *fictional-only* review packs
  as read-only staff personas. The borrower persona cannot access the route.

This is not a live-source reconciliation, approved credit policy, signed
document, real identity or verified tenant isolation. Source freshness and
bank/accounting reconciliation remain tracked by #160; the deeper facility
and client acceptance gaps are tracked by #102, #103, #109 and #110.

Acceptance: exact-head CI, the synthetic database reconciliation tests, an
authenticated hosted preview download and a manual small-screen/keyboard check
are required before merging. No live records, external provider credentials,
money movement or new production migrations.
