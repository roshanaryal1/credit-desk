# Credit memo provenance and human approval (proposed)

Issue #114.

The current delivered module is a deterministic **draft memo assembler**. It uses typed evidence with client ID, source ID, as-of business date and integer monetary value, and refuses cross-client, duplicate, future or unsourced figures. It includes explicit missing-evidence and review conditions, rather than inventing risk conclusions.

This module is *not an AI writing feature yet*: narrative LLM integration needs the existing citation validator, a source index, prompt-injection tests, persistent revisions and authenticated maker-checker sign-off. A human must review before any recommendation is actioned. Monetary facts must originate in the reconciled borrowing-base engine (#102), customer dossier (#103) and source checkpoints (#100), not untrusted model prose.

Do not export or deliver the assembled draft as an approved credit decision; never present demo data as real borrower material.
