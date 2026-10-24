# Credit memorandum review preview (proposed)

Issues #114/#109. Base PR #126 supplies the evidence-bound memo assembler.

Routes `/credit-memos` and `/credit-memos/[id]` provide a sober, read-only
credit memorandum view using exactly two values sourced from the deterministic
synthetic application database: the current facility commitment and the
funded-outstanding position as of the fixed demo date.

The screen **does not invent** a requested loan amount, eligible collateral,
verified debtor risk, mitigating conditions, risk score or lender
recommendation. These remain visibly missing from a structured checklist.
Every available amount has an evidence ID, source label and effective date.
The page states **DRAFT — NOT APPROVED** and has no signing, funding or
document-send control.

For operational readiness: real-source provenance (#100/#106), lender
math and approved facility policy (#102), borrower dossier history (#103),
authenticated role-bound review (#105/#109), evidence citation validation,
prompt-injection testing and human sign-off remain open. No PDF/export or
AI-generated narrative was implemented in this PR.

After design-system integration, the component can adopt the institution-wide
visual tokens from #117; it is currently a compatible isolated v1 route.
No merges without explicit owner authorization.
