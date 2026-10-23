# Credit Desk: specification

This file is the source of truth. Scope changes go through a pull request that
edits it. The design review that shaped this version is recorded in
[docs/reviews/2026-10-23-spec-review.md](docs/reviews/2026-10-23-spec-review.md);
finding ids (C1, X1, ...) are cited where a rule came from the review.

## 1. Goal

Build "Credit Desk": a prototype credit operations tool for an NZ invoice
finance lender, with three connected parts on one data model:

1. **Invoice Check:** before funding, every invoice in a batch is checked
   against the client's ledger, bank receipts and debtor history. An agent
   explains each flag and must cite its evidence. A person approves, holds or
   rejects.
2. **Portfolio Watch:** after funding, rules run daily across the book and
   raise alerts when a debtor slows down, a credit note hits a funded invoice,
   a funded invoice goes overdue, concentration rises, or a facility fills up.
3. **Trust Panel:** shadow-mode agreement between the agent and analysts,
   decision replay from frozen snapshots, and an evaluation report.

Principle: rules detect, the model explains, a validator checks the model, and
a person decides. The agent never approves, funds or changes anything.

This is a prototype, not production. Optimise for correctness of the checks,
honest evaluation, auditability and a clean demo. Depth over breadth: no loan
origination, payments or collections features.

## 2. Users and main flows

User: a credit analyst at the lender.

- **Overview (home):** funds in use against facility limits, batches waiting
  for review, open alert incidents by severity, and agent agreement on flagged
  invoices (live and simulated shown separately, each with its count).
- **Invoice Check:** open a batch, see each invoice's status (Clear, Flagged,
  High risk), open an invoice to see the checks that fired and, mode allowing,
  the explanation with cited evidence inline. Approve, Hold or Reject with a
  reason (required for Hold and Reject). Batch summary: face value, flagged
  value, fundable amount (section 4.3).
- **Portfolio Watch:** move an "as of" date through the 90-day history and see
  incidents appear. Each shows what changed, the evidence, and Acknowledge or
  Resolve with a note.
- **Trust Panel:** Agreement, Evaluation and Replay tabs.
- **Audit log:** every decision and incident action, newest first.

Decisions are append-only. An analyst may revise a decision; the latest one is
current, every one is replayable, and only the first decision per invoice
counts toward agreement (X4). Approving does not create a funding: funding
workflows are out of scope (C15).

## 3. Stack

| Choice | Why |
| --- | --- |
| Next.js 16 (App Router), TypeScript strict | One codebase for UI and API; deploys to Vercel |
| Tailwind CSS and shadcn/ui | Clean, professional UI fast |
| Postgres on Neon (Vercel Marketplace), Drizzle ORM | Real relational model; free tier. Write paths use the Neon `Pool` over WebSocket, because the HTTP driver does not support interactive transactions (C3) |
| Zod | Validate every input and every LLM output |
| Groq via the `openai` TypeScript SDK (`baseURL = https://api.groq.com/openai/v1`) | Free tier with tool calling. `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` env vars. Default `openai/gpt-oss-120b`, fallback `llama-3.3-70b-versatile`. Only the default provider is tested; others are a documented config change, not a guarantee (X25) |
| Recharts | Agreement and trend charts |
| Vitest | Tests for every check, watch rule, the validator, agreement maths and snapshot hashing |
| `scripts/eval.ts` | Deterministic evaluation report, run in CI |
| GitHub Actions | Typecheck, lint, format, test, build and eval on every push and PR |

## 4. Data model

### 4.1 Conventions

- Money: integer cents, NZD. Rates: integer basis points (8000 = 80.00%).
- Business dates (issue, due, paid, as-of): `YYYY-MM-DD` strings, interpreted
  in `Pacific/Auckland`. Event instants (created, decided, updated): UTC
  `timestamptz`, displayed in NZ time (X17).
- `DEMO_TODAY` in config is "today" for seed, checks, watch and UI. The wall
  clock is never used for business logic (C16).
- Every record that can change carries the date it became effective, so the
  book can be reconstructed as of any date without look-ahead (X1).

### 4.2 Tables

Reference data:
- `clients`: id, name, industry, advance_rate_bps (default 8000),
  facility_limit_cents, payment_terms_days.
- `debtors`: id, client_id, name, nzbn (synthetic, deliberately invalid check
  digit so it can never match a real business, C14), first_seen_date,
  credit_band.

What the client's systems say (synthetic, Xero- and Akahu-shaped):
- `ledger_entries`: id, client_id, invoice_number (unique per client),
  debtor_id, amount_cents, issue_date, recorded_date (when it first appeared in
  the ledger), supersedes_ledger_entry_id (nullable, for reissued invoices).
- `ledger_status_events`: ledger_entry_id, status (AUTHORISED, PAID, VOIDED),
  effective_date. Includes the initial AUTHORISED event. Status as of a date is
  the latest event on or before it (X1).
- `credit_notes`: id, ledger_entry_id, date, amount_cents.
- `bank_transactions`: id, client_id, date, amount_cents, counterparty_name,
  reference.
- `receipt_allocations`: bank_transaction_id, ledger_entry_id, amount_cents
  (supports partial and aggregated receipts, X14).
- `debtor_payments`: debtor_id, ledger_entry_id, invoice_number, issue_date,
  paid_date, amount_cents.

The lender's records:
- `batches`: id, client_id, submitted_date (business date; the as-of date for
  checks), status (PENDING, REVIEWED).
- `invoices`: id, batch_id, client_id, debtor_id, invoice_number, issue_date,
  due_date, amount_cents, description. These are submissions, so the same
  invoice number may appear in more than one batch; that is what DUP detects.
  Invoice numbers are scoped to the client, never matched across clients
  (X14).
- `fundings`: id, invoice_id, funded_date, advance_cents. Status as of a date
  (OUTSTANDING, COLLECTED, DILUTED, WRITTEN_OFF) is derived from adjustments up
  to that date, never stored.
- `funding_adjustments`: id, funding_id, date, kind (COLLECTION, DILUTION,
  WRITE_OFF), amount_cents. Outstanding exposure = advance minus the sum of
  adjustments up to the as-of date (X13).
- `findings`: id, invoice_id, check_id, severity, details_json,
  config_version, created_at.
- `agent_runs`: id, subject_type (INVOICE, INCIDENT), subject_id, provider,
  model, prompt_version, config_version, code_sha, attempts, status
  (PASSED, FAILED, ERROR), tokens_in, tokens_out, latency_ms, created_at.
  Immutable (C4, X18, X19).
- `explanations`: id, agent_run_id, summary, risk_level, recommendation
  (APPROVE, HOLD, REJECT, REQUEST_INFO), questions_for_client, claims_json,
  cited_evidence_ids, validation_status, validation_errors. Immutable.
- `decisions`: id, invoice_id, decision (APPROVE, HOLD, REJECT), reason,
  analyst_session_id, analyst_display_name, mode (SHADOW, ASSIST),
  explanation_id_at_decision (nullable), ai_content_exposed_before_decision
  (boolean), review_version, idempotency_key (unique), simulated (boolean),
  decided_at (X4, X12, X21).
- `decision_snapshots`: decision_id, canonical_json (text), sha256,
  prev_sha256, schema_version, created_at. Append-only (C1, C2, X11).
- `exposures`: session_id, invoice_id, exposed_at. Records that a session saw
  agent output for an invoice (9.1).
- `watch_detections`: id, rule_id, incident_key, as_of_date, details_json,
  config_version. One row per rule, incident key and date (X16).
- `incidents`: id, incident_key (unique), rule_id, client_id, debtor_id
  (nullable), funding_id (nullable), severity, first_detected_date,
  last_detected_date.
- `incident_events`: id, incident_id, status (OPEN, ACKNOWLEDGED, RESOLVED,
  REOPENED), note, actor, occurred_at. Status at any instant is the latest
  event at or before it (X16, C10).
- `audit_events`: id, actor, action, entity_type, entity_id, payload_json,
  created_at. Append-only.
- `rate_limit_events`: key, created_at (C12).
- Eval only: `labels` (invoice_id, expected_check_ids, including empty for
  clean cases) and `watch_labels` (rule_id, incident_key, expected_from_date,
  expected_to_date) (C5, X7).

Append-only tables (`agent_runs`, `explanations`, `decision_snapshots`,
`audit_events`, `incident_events`) have a database trigger that rejects UPDATE
and DELETE.

### 4.3 Money rules

- Advance for one invoice = floor(amount_cents x advance_rate_bps / 10000).
- Fundable amount for a batch = sum of advances for invoices whose current
  decision is APPROVE, capped at facility_limit_cents minus funds in use as of
  `DEMO_TODAY`. Rounding happens per invoice, then sums (X13).
- Funds in use = sum of outstanding exposure (section 4.2) as of the date.

## 5. Synthetic data

Build order matters (X22): fixtures, then checks and watch rules, then
explanations, then simulated decisions and snapshots, then evaluation.

- `scripts/seed.ts`: deterministic seeded generator. Requires an explicit
  `--target` (local, preview or production) and refuses to reset a database
  holding live (non-simulated) decisions unless `--force` is passed (X24).
- 4 fictional clients (logistics, wholesale, manufacturing, recruitment), about
  40 debtors. Fictional names only.
- 90 days of history ending on `DEMO_TODAY`: about 250 invoices across 8
  batches, about 150 funded. Ledger entries, bank receipts with allocations,
  12 months of debtor payment history.
- Seeded problems in about 15% of invoices, recorded in `labels`: duplicates,
  ledger mismatches, credit notes, voided, already paid, new debtors, slow
  payers, over-age, future-dated, concentration, and combined cases. Clean
  invoices get an explicit empty label.
- Tricky clean cases to measure false positives: a legitimate partial payment,
  and a reissued invoice whose original is VOIDED and superseded (C6).
- Scripted portfolio events, recorded in `watch_labels`: one debtor's
  days-to-pay drifts from 35 to 70, a credit note lands on a funded invoice,
  one client's debtor concentration creeps past the limit, two funded invoices
  go overdue.
- `scripts/simulate-decisions.ts` (after precompute): about 120 past analyst
  decisions with `simulated = true`, `mode = SHADOW`, each bound to the
  explanation it was compared against, with realistic disagreement. Always
  labelled as simulated in the UI.
- Two batches left PENDING for live review.
- A second seed (`--seed=holdout`) with different parameters is used only for
  evaluation (C9, X8).

## 6. Checks (`lib/checks/`)

Pure functions: `(invoice, context) -> Finding | null`. The context is built as
of the batch's submission date and contains only records effective on or
before it (X1). Thresholds and `CONFIG_VERSION` live in `lib/checks/config.ts`
with a comment explaining each default.

| ID | Check | Default rule | Severity |
| --- | --- | --- | --- |
| DUP | Duplicate or double-submitted | Same client and invoice number in another invoice, or same debtor and amount with issue dates within 7 days. Excludes the invoice itself and any match whose ledger entry is VOIDED and superseded by this one | High |
| LEDGER_MISSING | Not in the ledger | No ledger entry for the client and invoice number with recorded_date on or before submission | High |
| LEDGER_MISMATCH | Ledger disagrees | Amount, debtor or issue date differs from the ledger entry | High |
| VOIDED | Voided in the ledger | Ledger status (from status events) VOIDED as of submission | High |
| CREDIT_NOTE | Diluted by a credit note | Any credit note dated on or before submission; High if credited total over 20% of value | Medium or High |
| ALREADY_PAID | Already paid | Receipts allocated to the ledger entry before submission cover at least 99% of the amount | High |
| NEW_DEBTOR | New debtor | First seen under 60 days before submission, or no payment history | Medium |
| SLOW_PAYER | Slow-paying debtor | Mean days-to-pay over terms + 30, from at least 3 payments in the 12 months before submission | Medium |
| OVER_AGE | Too old to fund | Issued over 90 days before submission | High |
| FUTURE_DATED | Dated in the future | Issue date after submission date | High |
| CONCENTRATION | Debtor concentration | This debtor's share of (client's outstanding funded face value + this batch's face value) over 30%. Each invoice counted once. Not evaluated when the total is zero (X15) | Medium |

Status: Clear when no finding, High risk when any High finding, else Flagged.

## 7. Watch rules (`lib/watch/`)

Pure functions over the book reconstructed as of a date:
`(asOfDate, book) -> Detection[]`. Each detection has a stable `incident_key`.
Running a date twice creates no duplicates. A new incident opens on the first
detection; consecutive detections extend it; a detection after RESOLVED
reopens it (X16). Thresholds live in the same config file.

| ID | Rule | Default | Severity |
| --- | --- | --- | --- |
| PAYMENT_DRIFT | Debtor slowing down | Mean days-to-pay for payments with paid_date in (asOf-60, asOf] exceeds the mean for (asOf-150, asOf-60] by more than 15 days; at least 3 payments in each window (C11) | Medium |
| FUNDED_CREDIT_NOTE | Dilution after funding | A credit note dated on or before asOf on an invoice with outstanding exposure | High |
| OVERDUE_FUNDED | Funded invoice overdue | Outstanding exposure and asOf more than 30 days past due date | High |
| CONCENTRATION_CREEP | Concentration rising | A debtor's share of a client's outstanding exposure is over 30% on asOf and was not on the previous date | Medium |
| FACILITY_UTILISATION | Facility nearly full | Funds in use over 90% of the client's facility limit | Low |

`scripts/watch.ts --as-of=YYYY-MM-DD` runs one date; `--from --to` runs a
range. `/api/watch/run` runs `DEMO_TODAY` for an optional Vercel Cron job; it
is exempt from the password gate and requires `Authorization: Bearer
$CRON_SECRET` (C13).

## 8. Agent (`lib/agent/`)

- Runs on Flagged and High risk invoices and on High incidents. Never on Clear
  invoices.
- Read-only tools, each scoped to the subject's client and validated with Zod:
  `get_invoice`, `get_ledger_entry`, `get_bank_transactions(debtor,
  date_range)`, `get_debtor_history(debtor)`, `get_findings(invoice)`,
  `get_funding(invoice)`, `get_incident(incident)`. Tools only return records
  effective on or before the subject's as-of date (X1).
- Output (Zod): `{ summary (max 60 words), risk_level, recommendation,
  questions_for_client: string[], claims: [{ text, evidence_ids: string[] }],
  cited_evidence_ids: string[] }`.
- Prompt rules: state only what the evidence shows; every claim cites record
  ids; never invent amounts, dates or names; never say anything is approved or
  funded; say "insufficient evidence" when unsure.
- Validator, after every attempt:
  - output parses against the schema;
  - every cited id exists, belongs to the subject's client, and was returned
    by a tool call in this run;
  - every dollar amount and date in a claim matches a field of a record that
    claim cites;
  - the summary's amounts and dates each appear in some cited record.
  Limits, stated in the UI: the validator proves citations and figures are
  grounded, not that the reasoning is right (X9).
- On failure: one retry with the errors fed back. Second failure stores
  `validation_status = FAILED` and the UI shows "Explanation unavailable, see
  the raw findings." Raw findings are always shown.
- Prompts in `lib/agent/prompts/` with `PROMPT_VERSION`; each run stores
  provider, model, prompt version, config version and git SHA.
- Budgets per run: 6 tool calls, fixed max tokens, 30 seconds total wall time
  covering all attempts and backoff (X19). Malformed tool arguments end the
  attempt with a validation error.
- Groq free tier (roughly 30 requests/min, 8,000 tokens/min and 1,000
  requests/day for `openai/gpt-oss-120b`; confirm on Groq's rate limits page
  before relying on these): `scripts/precompute.ts` runs one item at a time,
  keeps a tokens-per-minute budget, retries 429s with exponential backoff that
  honours `retry-after`, and is resumable (skips subjects with a PASSED run for
  the current prompt and config version).
- No reliance on provider-side strict JSON schema. JSON mode where supported,
  then Zod plus the validator.

## 9. Trust Panel (`lib/trust/`)

### 9.1 Shadow mode protocol (X2, X3, X4)

- Mode per analyst session: SHADOW (default) or ASSIST.
- In SHADOW the server withholds all agent output for the invoice (summary,
  risk level, recommendation, questions, claims) until a decision is saved. The
  client never receives it early.
- Exposure is recorded per session and invoice. A decision counts toward
  agreement only if mode was SHADOW, no agent content was exposed before it,
  it is the first decision on that invoice, it is bound to an explanation with
  `validation_status = PASSED`, and it is not a revision.

### 9.2 Agreement metrics

- Population: eligible decisions on flagged invoices (section 9.1). Excluded
  counts are shown with reasons. Labelled "agreement on flagged invoices".
- Mapping for agreement and kappa: REQUEST_INFO counts as HOLD. The confusion
  matrix keeps all four recommendation values (C7).
- Metrics: overall agreement and Cohen's kappa; agreement per check (a
  decision counts toward every check that fired, and the UI says these groups
  overlap); per risk level; confusion matrix; weekly trend; disagreements list
  linking to replay.
- Every rate shows its n and a 95% Wilson interval. Kappa shows "n/a" when
  expected agreement is 1 or n is 0 (X6).
- Live and simulated cohorts are separate by default, with a toggle to combine.
- Per-check summary line, descriptive only, for example: "DUP: agreed on 31 of
  33 live shadow decisions (94%, 95% CI 80 to 98%)." Below the minimum n in
  config it reads "Not enough live decisions yet." No automation-readiness
  claims (X5).

### 9.3 Decision replay (C1, C2, X10, X11, X12)

- The decision form carries a `review_version` (hash of the findings and
  explanation the analyst saw) and an idempotency key. The server recomputes
  the version in the transaction and rejects stale or duplicate submissions.
- In one transaction: insert the decision, its snapshot and an audit event.
- The snapshot freezes everything needed to show the decision as made: the
  invoice, ledger entry, credit notes, allocated bank lines, the full inputs
  each fired check used (other invoices for DUP, book totals for
  CONCENTRATION, payment rows for SLOW_PAYER), findings, the config and
  `CONFIG_VERSION`, the explanation with its run metadata and prompt text, the
  mode, exposure flag and the decision. Plus `schema_version` and git SHA.
- Serialisation: canonical JSON (sorted keys, no insignificant whitespace),
  stored as `text`. SHA-256 is over that exact string. Each snapshot stores the
  previous snapshot's hash, forming a chain.
- The replay page renders only from the snapshot and shows "Checksum matches"
  when the stored hash and chain verify. It states that this detects accidental
  change and casual edits, not a determined database administrator; production
  would anchor hashes externally or use WORM storage.
- "What changed since" diffs the snapshot against live data, for example "A
  credit note of $4,200.00 dated 14 Oct was added."

### 9.4 Evaluation (X7, X8)

- Checks: TP, FP, FN, TN, precision and recall per check against `labels`.
- Watch rules: an incident matches a `watch_labels` row when rule and incident
  key match and first detection falls inside the expected window. Precision and
  recall per rule.
- Metrics are reported on the development seed and the holdout seed. A metric
  with no positives shows "n/a".
- Agent (from stored runs, no API calls in CI): schema pass rate, citation
  validity, amount and date faithfulness, retry rate, average tokens, latency.
- Output: `eval/report.json`, shown in the Evaluation tab with limits:
  synthetic data, small sample, thresholds not calibrated on real losses.
- CI fails if any check's precision or recall on the holdout seed drops below
  its configured minimum.

## 10. UI

- Pages: Overview, Batches, Batch detail (with invoice panel), Portfolio Watch,
  Trust Panel (Agreement, Evaluation, Replay), Audit log, About.
- Persistent banner: "Prototype for discussion. All data is synthetic."
- Status and severity chips use text and colour, never colour alone. Tabular
  numbers for money.
- Evidence appears inline next to each claim, linked by cited id. Explanation
  text is rendered from validated claims; values come from the cited records.
- Portfolio Watch: date stepper and a small incident timeline per client.
- About page: the problem, the approach, the principle, an architecture
  diagram, what is real versus synthetic, and what production would need. It
  may carry one line saying the prototype was built for discussion with
  Runway's team. Nowhere else names Runway; no Runway logo or colours.
- Calm, professional design for a credit team. Light and dark themes, works on
  a phone, keyboard accessible.
- No real company names or logos.

## 11. Security and operations (prototype level, stated honestly)

- Password gate in `proxy.ts` (Next.js 16 renamed `middleware` to `proxy`):
  `DEMO_PASSWORD` checked with a constant-time compare; on success, a signed,
  expiring session cookie (HMAC with `SESSION_SECRET`, httpOnly, Secure,
  SameSite=Lax, 12-hour expiry). Login attempts throttled per IP (X20).
- Mutating routes check the session server-side and the `Origin` header.
- Analysts enter a display name at login. Audit records store the session id
  and the self-declared name, and the UI says attribution is not
  authenticated (X21).
- LLM key only on the server (`server-only` modules), never in client code or
  the repo. `.env.example` lists every variable; `.env*` other than the example
  is git-ignored.
- Agent re-runs: 10 per hour per session and per IP, plus a global daily cap
  well under the provider's daily limit, counted in Postgres (C12).
- Preview deployments use their own database branch, never production data
  (X24).
- Structured logs for every agent call and watch run.
- README section "What production would need": real auth with roles and
  maker-checker approval, Xero and Akahu integrations under accreditation,
  immutable audit storage with external anchoring, retention under the Privacy
  Act 2020, AML/CFT considerations, threshold calibration on real loss data,
  monitoring and alerting, and a provider and data-residency review before any
  real customer data.

## 12. Repo layout

```
app/                  routes and pages (proxy.ts at the root)
components/
lib/
  checks/             invoice checks + config
  watch/              watch rules
  agent/              llm client, tools, prompts, validator, runner
  trust/              agreement metrics, snapshots, replay diff
  data/               adapters (synthetic now; Xero and Akahu interfaces)
  db/                 Drizzle schema, migrations, queries
scripts/              seed.ts watch.ts precompute.ts simulate-decisions.ts eval.ts
eval/report.json
tests/
docs/adr/  docs/reviews/
```

## 13. Delivery tiers and definition of done

Tier 1 must ship (X23): Overview; Invoice Check end to end with all eleven
checks; precomputed, validated explanations; shadow-mode decisions with
verified snapshots and replay; Agreement and Evaluation tabs; password gate;
deployed.

Tier 2, in cut order if time runs short: Vercel Cron job, dark theme,
Portfolio Watch timeline chart, Portfolio Watch. The Trust Panel and the
evaluation are never cut.

Done means:
- Deployed on Vercel behind the password; works on desktop and phone.
- All shipped pages work on seeded data.
- A live shadow-mode decision writes a snapshot whose checksum verifies and
  updates the live agreement cohort.
- Evaluation shows real numbers from `scripts/eval.ts` on both seeds.
- Tests and CI pass.
- README with screenshots, a mermaid architecture diagram, how to run locally,
  evaluation results, limitations and production needs.
- A 3-minute walkthrough recording.
