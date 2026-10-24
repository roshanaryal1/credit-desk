# Synthetic credit-memo export (#114)

A reviewer can download the existing deterministic Credit Desk assessment
as a Markdown file from the memo detail page. The file includes an emphatic
DRAFT / SYNTHETIC / NO APPROVAL banner, client and date identifiers, all
evidence-backed statements with source IDs, source register, missing-fact
checklist, version and explicit unsigned status.

The exporter validates provenance for each cited statement, source client,
source date and amount. Unsupported references and any apparent approved
memo fail closed. Inline markup from text is escaped before serialization.
Delivery is private and no-store. It does not invoke an LLM, decide a loan,
sign a memo, render a live-data PDF or transfer funds.

This is partial #114, not full acceptance. Still needed: versioned persisted
analyst edits with immutable history; separately identity-verified checker
sign-off, fine-grained permissions, document lifecycle and privacy retention,
source first-observed-time gates, professional PDF generation, adversarial
tests and independent financial-domain acceptance.

All work and data in this PR are synthetic only.
