# ADR-0014 — Product-specific principal models (proposed)

Issue #108. This first module deliberately covers only **principal** calculations for synthetic revolving and term facilities. It cannot quote interest, fees, repayment schedules, total cost, penalties or borrower obligations.

A revolving facility's capacity is limit minus currently outstanding principal; repayments release capacity. A term facility's available undrawn commitment is limit minus *lifetime drawn*, regardless of repayments. Both reject overdraw, overrepayment, duplicate movement IDs, before-start activity and draws after maturity. Whole-day dates use explicit business dates and are replayable as of earlier dates.

Real facility contracts differ: draw windows, amortisation, expiry, interest/fees, covenant events, multi-currency/cross-collateral restrictions, early repayment, restructuring and capitalisation require separate approved rules. Do not use this calculation for live underwriting or to move funds. Disbursement orchestration belongs to #107 and requires verified maker-checker and bank authorization. This PR remains draft under the merge freeze.
