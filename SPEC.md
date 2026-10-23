# Invoice Check: specification

This file is the source of truth for the project. Changes to scope go through a
pull request that edits this file.

## 1. Goal

Build "Invoice Check": a prototype invoice verification tool for an NZ invoice
finance lender, built for Runway as a conversation starter. It flags risky
invoices in a funding batch, explains each flag with cited evidence, keeps a
human in the loop for every decision, and reports its own accuracy against a
labelled synthetic dataset.

This is a prototype, not production. Optimise for clarity, correctness of the
checks, honest evaluation and a clean demo. Do not over-engineer.

## 2. Users and flow

User: a credit analyst at the lender.

1. The analyst sees a list of clients and their pending funding batches.
2. The analyst opens a batch: a table of invoices with status chips (Clear,
   Flagged, High risk), a batch summary (total face value, flagged value,
   fundable amount at the client's advance rate) and concentration by debtor.
3. Clicking an invoice opens a detail panel: the invoice, each triggered check,
   the agent's explanation, and the cited evidence (ledger entry, bank lines,
   debtor payment history) shown inline.
4. The analyst chooses Approve, Hold or Reject, with a required reason for Hold
   and Reject.
5. An audit log records who decided what, when, which checks fired, and which
   model and prompt version produced the explanation.
6. An Evaluation page shows precision and recall per check and the agent's
   citation validity rate on the labelled dataset.

## 3. Stack

| Choice | Why |
| --- | --- |
| Next.js (App Router) with TypeScript, strict mode | One codebase for UI and API, deploys to Vercel in minutes |
| Tailwind CSS and shadcn/ui | Clean, professional UI fast |
| Postgres on Neon (via Vercel Marketplace), Drizzle ORM | Real relational model for invoices, decisions and audit log; free tier |
| Zod | Validate every external input and every LLM output |
| Groq API through the `openai` TypeScript SDK (Groq is OpenAI-compatible: `baseURL = https://api.groq.com/openai/v1`) | Free tier, fast, supports tool calling. Provider-agnostic: base URL, key and model all come from env vars (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`), so switching to Claude or OpenAI later is a config change. Default model `openai/gpt-oss-120b`; fallback `llama-3.3-70b-versatile` |
| Vitest | Unit tests for every check and the validator |
| A `scripts/eval.ts` runner | Prints and saves the evaluation report; runs in CI |
| GitHub Actions | Typecheck, lint, test and eval on every push |

## 4. Data model (synthetic, Xero- and Akahu-shaped)

- `clients`: id, name, industry, advance_rate (0.80 default), payment_terms_days.
- `debtors`: id, client_id, name, nzbn, first_seen_date, credit_score
  (synthetic, Centrix-shaped band).
- `invoices` (the funding batch): id, client_id, debtor_id, invoice_number,
  issue_date, due_date, amount_nzd, description, batch_id, submitted_at.
- `ledger_entries` (what the client's accounting system says): id, client_id,
  invoice_number, debtor_id, amount_nzd, issue_date, status (AUTHORISED, PAID,
  VOIDED), credit_notes (array of {id, date, amount}).
- `bank_transactions` (Akahu-shaped): id, client_id, date, amount_nzd,
  counterparty_name, reference.
- `debtor_payment_history`: debtor_id, invoice_number, issue_date, paid_date,
  amount_nzd.
- `findings`: invoice_id, check_id, severity, details_json, created_at.
- `explanations`: invoice_id, summary, suggested_action, cited_evidence_ids,
  model, prompt_version, validation_status, created_at.
- `decisions`: invoice_id, decision (APPROVE, HOLD, REJECT), reason, analyst,
  decided_at.
- `labels` (eval only): invoice_id, expected_check_ids.

Money is stored in integer cents. Dates are ISO strings in NZ time. All amounts
in NZD.

## 5. Synthetic data generator (`scripts/seed.ts`)

- Deterministic, seeded random generator, so every run produces the same
  dataset.
- 4 fictional clients across logistics, wholesale, manufacturing and
  recruitment. Fictional names only, no real companies.
- About 40 debtors and 200 invoices across 6 batches, with ledger entries, bank
  receipts and 12 months of debtor payment history.
- Seed known problems into about 15% of invoices and record them in `labels`:
  duplicates, ledger mismatches, credit notes after submission, voided
  invoices, brand-new debtors, slow payers, over-age invoices, future-dated
  invoices, concentration breaches, and a few combined cases.
- Include some tricky clean cases (a legitimate partial payment, a reissued
  invoice with a new number) to measure false positives honestly.

## 6. Checks (`lib/checks/`)

Each check is a pure function: `(invoice, context) -> Finding | null`. Each has
its own tests.

| ID | Check | Rule (configurable) | Severity |
| --- | --- | --- | --- |
| DUP | Duplicate or double-submitted | Same debtor and amount within 7 days, or same invoice number, across this and earlier batches | High |
| LEDGER_MISSING | Not in the ledger | No matching invoice number in `ledger_entries` | High |
| LEDGER_MISMATCH | Ledger disagrees | Amount, debtor or issue date differs from the ledger entry | High |
| VOIDED | Voided in the ledger | Ledger status is VOIDED | High |
| CREDIT_NOTE | Diluted by a credit note | Any credit note on the invoice; severity rises with share of value | Medium or High |
| ALREADY_PAID | Already paid | A bank receipt from the debtor matches the amount and reference before submission | High |
| NEW_DEBTOR | New debtor | Debtor first seen under 60 days ago, or no payment history | Medium |
| SLOW_PAYER | Slow-paying debtor | Average days-to-pay over terms + 30 in the last 12 months | Medium |
| OVER_AGE | Too old to fund | Issued more than 90 days before submission | High |
| FUTURE_DATED | Dated in the future | Issue date after submission date | High |
| CONCENTRATION | Debtor concentration | One debtor over 30% of the batch's face value | Medium |

Write thresholds in one config file with comments explaining each default.

## 7. Agent (`lib/agent/`)

Runs only on flagged invoices.

- Tools the model can call (read-only, server-side): `get_invoice`,
  `get_ledger_entry`, `get_bank_transactions(debtor, date_range)`,
  `get_debtor_history(debtor)`, `get_findings(invoice)`.
- Output is a JSON object validated with Zod:
  `{ summary: string (max 60 words), risk_level: "low" | "medium" | "high",
  suggested_action: "approve" | "hold" | "reject" | "request_info",
  questions_for_client: string[], cited_evidence_ids: string[] }`.
- System prompt rules: explain only what the evidence shows; cite the record id
  for every claim; never invent amounts, dates or names; never claim the
  invoice is approved; say "insufficient evidence" when unsure.
- Validator, which runs after every model call:
  - Every cited id exists and belongs to this invoice's client.
  - Every dollar amount in the summary matches an amount in the cited records.
  - The output parses against the schema.
  - On failure: retry once with the validation errors fed back to the model; if
    it fails again, store `validation_status = failed` and show "Explanation
    unavailable, see raw findings" in the UI.
- Prompts live in `lib/agent/prompts/` with a `PROMPT_VERSION` constant saved
  on every explanation.
- Precompute explanations at seed time so the demo never waits on the API. Add
  a "Re-run agent" button per invoice for a live demo.
- Cost and safety: cap each run at 6 tool calls and a fixed max tokens setting;
  time out after 30 seconds; log token usage per call.
- Groq free tier limits (roughly 30 requests per minute, 8,000 tokens per
  minute and 1,000 requests per day for `openai/gpt-oss-120b`; confirm on
  Groq's rate limits page): the precompute script must run invoices one at a
  time, keep a client-side token budget per minute, and retry 429 responses
  with exponential backoff that honours the `retry-after` header. Expect the
  precompute to take 10 to 20 minutes; that is fine because it runs once.
- Structured output: do not rely on provider-side strict JSON schema, because
  support varies by Groq model. Ask for JSON in the prompt, use JSON mode where
  the model supports it, and always parse with Zod plus the citation validator.
  The validator is the guarantee, not the provider.
- Keep a `LLM_PROVIDER` label (for example `groq`) and the model name on every
  saved explanation so results are traceable if you switch providers.

## 8. Evaluation (`scripts/eval.ts` and the /evaluation page)

- For each check: precision, recall and counts against `labels`.
- For the agent: citation validity rate, amount-faithfulness rate, schema pass
  rate, retry rate and average tokens per explanation.
- Save the results to `eval/report.json` and show them in the app with a short
  note on what the numbers mean and their limits (synthetic data, small
  sample).
- CI fails if any check's recall drops below the threshold set in config.
- The page also lists known limitations honestly: synthetic data, no real Xero
  or Akahu connection, thresholds not calibrated on real losses.

## 9. UI

- Pages: Batches (home), Batch detail, Invoice detail panel, Audit log,
  Evaluation, About.
- Batch summary at the top: face value, flagged value, fundable amount, a
  debtor concentration bar.
- Status chips with colour and text (never colour alone).
- Evidence shown inline next to each claim, linked by cited id.
- Persistent banner: "Prototype built for Runway, for discussion. All data is
  synthetic."
- An About page: problem, approach, architecture diagram, what is real versus
  synthetic, what you would do next.
- Responsive down to a phone width, keyboard accessible, light and dark themes.
- Runway is named as the audience in text only ("a prototype built for
  Runway"). No Runway logo, colours or brand assets, and no other real company
  names or logos. Seeded clients and debtors are always fictional.

## 10. Security and operations (prototype level, stated honestly)

- The whole app sits behind a shared password: a simple middleware check
  against `DEMO_PASSWORD`, with an httpOnly session cookie.
- The LLM API key exists only on the server, never in client code or the repo.
- `.env.example` lists every variable; `.env*` is git-ignored.
- Rate-limit the "Re-run agent" endpoint (for example 10 runs per hour per
  session) so a leaked link cannot run up costs.
- Structured logs for every agent call: invoice id, model, prompt version,
  tokens, latency, validation result.
- A README section titled "What production would need": real auth with roles,
  Xero and Akahu integrations under accreditation, a full audit trail, data
  retention under the Privacy Act 2020, AML/CFT considerations, threshold
  calibration on real loss data, monitoring and alerting.

## 11. Repo layout

```
invoice-check/
  app/                Next.js routes and pages
  components/         UI components
  lib/
    checks/           one file per check, plus index and config
    agent/            tools, prompts, validator, runner
    data/             adapters (synthetic now; Xero and Akahu interfaces)
    db/               Drizzle schema and queries
  scripts/
    seed.ts           deterministic synthetic data and labels
    eval.ts           evaluation runner
  eval/report.json
  tests/
  SPEC.md
  CLAUDE.md
  README.md
  .env.example
  .github/workflows/ci.yml
```

## 12. Definition of done

- Deployed on Vercel behind a password; the link works on desktop and phone.
- Seeded data loads; every batch shows findings and precomputed explanations.
- Analyst decisions persist and appear in the audit log.
- Evaluation page shows real numbers from `scripts/eval.ts`.
- Tests and CI pass.
- README with a screenshot, architecture diagram, how to run locally,
  evaluation results, limitations and next steps.
- A 2-minute screen recording of the demo.
