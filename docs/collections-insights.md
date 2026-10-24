# Collections intelligence: synthetic review slice

Tracks #104 (partial delivery), with the client experience in #111.

This change adds as-of debtor collections indicators to the existing deterministic ledger. It is not an authorised lending decision, fraud forecast, approved DSO or live accounting report.

- Receipt windows are two consecutive 30-calendar-day periods (recent window includes the as-of date); future receipts and credits cannot leak in.
- Overdue movement compares effective-dated outstanding balances now and 30 days earlier. Positive movement is descriptive, not evidence of default.
- Mean days to full cash settlement uses only entirely cash-paid invoices without credit notes; excludes partial payments, credited invoices and zero-face rows.
- DSO remains null until complete credit-sales history, opening and closing receivables, source coverage, and a validated accounting policy are available.
- Evidence references include invoice IDs and receipt/credit source IDs. No synthetic signal can authorise funds.
- Client terms and source history remain synthetic and not certified.

Still pending for #104: verified DSO methodology, source completeness, write-off and amended due-date semantics, scale and accessibility testing, debtor drilldowns, and provider security gates under #100/#106/#109.

Unit scenarios: historic replay, receipt-window boundaries, future event exclusion, full settlement timing, credited invoices, invalid dates, source IDs and impossible values.
