# Design review: Credit Desk specification

- Date: 2026-10-23
- Scope: the Credit Desk build brief before implementation
- Method: two independent reviews of the same draft. Findings prefixed `C`
  come from review A, `X` from review B. Overlaps are noted.
- Outcome: every P1 finding is resolved in SPEC.md; P2 findings are resolved
  or explicitly accepted below.

| # | Sev | SPEC section | Finding | Resolution adopted in SPEC.md |
| --- | --- | --- | --- | --- |
| C1 | P1 | 9 Replay, 4 | SHA-256 over `snapshot_json` breaks if the snapshot is stored as `jsonb`: Postgres reorders keys and normalises whitespace, so the recomputed hash will not match. | Hash canonical JSON (sorted keys, no whitespace); store the canonical string as `text` and verify against that exact string. |
| C2 | P1 | 9 Replay | A hash alone is not tamper evidence: anyone who can rewrite the row can rewrite the hash. "Immutable" is also not enforced. | Hash chain (`prev_sha256` in each snapshot) plus a DB trigger that rejects UPDATE and DELETE on `decision_snapshots` and `audit_events`. State honestly that production needs external anchoring or WORM storage. |
| C3 | P1 | 3, 4, 9 | Decision + snapshot + audit event in one transaction cannot run on Neon's HTTP driver: `neon()` sends one query per fetch, "sessions and transactions are not supported" (Neon serverless README). | Use `Pool` over WebSocket (or node-postgres) for write paths with Drizzle transactions. |
| C4 | P1 | 4, 7, 8 | `explanations` has only `invoice_id`, but the agent also explains High alerts, and several alerts (PAYMENT_DRIFT, CONCENTRATION_CREEP, FACILITY_UTILISATION) have no invoice. Tools are invoice-only. | `explanations` gets `subject_type` (INVOICE, ALERT) and `subject_id`; add `get_alert` and `get_debtor_summary` tools. |
| C5 | P1 | 9 Eval, 4 | Watch-rule precision and recall need ground truth, but `labels` only covers invoices. | Add `watch_labels(rule_id, client_id, debtor_id, funding_id, expected_from_date)` written by the seed's scripted events. |
| C6 | P1 | 5, 6 | Tricky clean case "reissued invoice with a new number" will trip DUP (same debtor, same amount, within 7 days), so the clean label contradicts the rule. | DUP ignores a match whose ledger entry is VOIDED and whose replacement references it; config documents the exemption; test covers it. |
| C7 | P1 | 9 Agreement | Agent recommendation has 4 values (APPROVE, HOLD, REJECT, REQUEST_INFO), analyst decision has 3. Kappa and the confusion matrix need a defined mapping. "Agreement per check" is ambiguous when several checks fire on one invoice. | Map REQUEST_INFO to HOLD for agreement, keep the 4x3 matrix for display. A decision counts toward every check that fired on that invoice; say so in the UI. Kappa is undefined when expected agreement is 1: show "n/a". Show n per metric and hide readiness lines under a minimum n from config. |
| C8 | P2 | 9 Agreement, 5 | Headline agreement on Overview will be mostly simulated data (120 simulated vs a handful live). Readiness lines computed from simulated decisions could read as evidence. | Overview shows live-only and simulated-inclusive numbers side by side with labels; readiness lines need a minimum count of live decisions or say "simulated only". |
| C9 | P2 | 9 Eval | Generator and checks are written together against the same labels, so precision and recall near 100% prove little. | Evaluate on a second, held-out seed generated with different parameters, and report both. Say so on the Evaluation tab. |
| C10 | P2 | 2, 7 | Date stepper semantics are undefined: alert actions (Acknowledge, Resolve) happen in real time, but the view is "as of" a past date. Moving backwards could show resolved alerts as open or vice versa. | As-of view shows alerts with `as_of_date <= date`; status always shows the current real status plus when it changed. |
| C11 | P2 | 7 | PAYMENT_DRIFT windows are ambiguous (by paid date or issue date; overlapping windows?). | Define: payments with `paid_date` in (asOf-60, asOf] vs (asOf-150, asOf-60]; minimum 3 payments in each window. |
| C12 | P2 | 11 | "10 re-runs per hour per session" is bypassed by clearing the cookie, and in-memory counters do not work across serverless instances. | Rate limit stored in Postgres, keyed by session and by IP, plus a global daily cap below the Groq daily limit. |
| C13 | P2 | 11, 7 | Next.js 16 deprecated `middleware` and renamed it `proxy` (installed docs). The password gate would also block `/api/watch/run` for Vercel Cron. | Implement the gate in `proxy.ts`; exempt the cron route, which checks `Authorization: Bearer $CRON_SECRET`. |
| C14 | P2 | 4, 5 | Synthetic NZBNs could collide with real ones. | Generate 13-digit values with a deliberately invalid GS1 check digit so they can never be real. |
| C15 | P2 | 2, 4 | Undefined: can an analyst change a decision, and does Approve create a funding? | Decisions are append-only; latest one wins, all are replayable. Live approvals do not create fundings (no funding features in scope). |
| C16 | P2 | 5 | "Fixed today" must drive every date calculation, never the wall clock, or the demo drifts. | `DEMO_TODAY` constant in config, used by seed, checks, watch and UI. |

## Review B

| # | Sev | SPEC section | Finding | Resolution adopted in SPEC.md |
| --- | --- | --- | --- | --- |
| X1 | P1 | 4 to 7, 9 | Current statuses cannot reconstruct the book at a past date; later payments and credit notes leak into earlier checks. | Effective dates on every changing record; check, watch and tool contexts only see records effective on or before their as-of date (4.1, 6, 7, 8). |
| X2 | P1 | 2, 8 to 10 | Hiding only the recommendation still shows the explanation and risk level before the decision; switching modes keeps exposure. | Server withholds all agent output in SHADOW; exposure recorded per session and invoice; exposed decisions excluded (9.1). |
| X3 | P1 | 4, 8, 9 | No defined comparison population: clear invoices, failed explanations and REQUEST_INFO. | Eligibility rules, mapping, excluded counts shown, labelled "agreement on flagged invoices" (9.1, 9.2). Overlaps C7. |
| X4 | P1 | 4, 9 | Decisions are not bound to the explanation they were compared with; reruns and revisions distort agreement. | `explanation_id_at_decision`; only the first decision per invoice counts; simulated kept separate (4.2, 9.1). |
| X5 | P1 | 5, 9 | Readiness wording overstates what agreement with simulated analysts shows. | Descriptive per-check line with n and interval; no automation-readiness claims (9.2). Overlaps C8. |
| X6 | P2 | 9 | Kappa and subgroup maths underspecified. | Mapping, n/a rules, denominators, Wilson intervals, overlap note (9.2). |
| X7 | P1 | 4 to 7, 9 | Labels cannot evaluate watch rules: no negatives, timing or entity matching. | `watch_labels` with incident key and detection window; explicit empty labels for clean invoices (4.2, 9.4). Overlaps C5. |
| X8 | P1 | 9 | Recall-only gate rewards flagging everything; seed-tuned evaluation. | Gate on precision and recall, holdout seed, full TP/FP/FN/TN, n/a for no positives (9.4). Overlaps C9. |
| X9 | P1 | 8 | A valid id and a matching amount do not prove a claim is true; a flat citation list cannot back inline citations. | Structured claims with per-claim evidence; ids must come from this run's tool results; dates checked too; limits stated in the UI (8). |
| X10 | P1 | 4, 9 | Snapshot omits inputs needed to reproduce DUP, CONCENTRATION and SLOW_PAYER; versions do not preserve prompt or code. | Snapshot freezes full check inputs, prompt text, config, schema version and git SHA (9.3). |
| X11 | P1 | 9 | Hash verification overstates integrity; serialisation unspecified. | Canonical JSON as text, hash chain, append-only triggers, "Checksum matches" wording with stated limits (9.3). Overlaps C1, C2. |
| X12 | P1 | 4, 9 | Data can change between render and save; double submits and concurrent analysts. | `review_version` check inside the transaction, idempotency key, audit event in the same transaction (9.3). |
| X13 | P1 | 2, 4, 6, 7 | No model for collections, dilution or exposure; fundable amount rules undefined. | `funding_adjustments`, exposure formula, basis points, rounding order and facility cap (4.2, 4.3). |
| X14 | P1 | 4, 6 | Duplicate and receipt matching misclassify ordinary records. | Client-scoped invoice numbers, self-exclusion, supersession, `receipt_allocations` (4.2, 6). Overlaps C6. |
| X15 | P1 | 6, 7 | Concentration bases ambiguous and can double count; "crosses" needs a prior observation. | Separate pre-funding and exposure formulas, zero-denominator rule, previous-date comparison (6, 7). |
| X16 | P1 | 4, 7 | Daily uniqueness still yields one alert per day for one problem; current status rewrites history. | Detections vs incidents vs status events; status reconstructed at any instant (4.2, 7). Overlaps C10. |
| X17 | P2 | 4, 6, 7 | Payment statistic boundaries and date vs instant semantics unclear. | Disjoint windows, minimum counts, business dates vs UTC instants (4.1, 6, 7). Overlaps C11. |
| X18 | P1 | 4, 8, 9 | Alert explanations and agent evaluation have no storage. | `agent_runs` and `explanations` with typed subject and full run metadata (4.2). Overlaps C4. |
| X19 | P1 | 8 | No shared time budget across attempts, retries and backoff; failure modes unspecified. | 30-second total budget, malformed-argument handling, resumable precompute, raw findings always shown (8). |
| X20 | P1 | 11 | Cookie alone gives no session integrity; no throttling, expiry, CSRF or global quota. | Signed expiring sessions, login throttling, Origin checks, global daily cap (11). Overlaps C12. |
| X21 | P2 | 4, 11 | A free-text analyst name does not establish identity. | Session id plus self-declared name; UI states attribution is not authenticated (11). |
| X22 | P1 | Build plan | Simulated decisions and alert explanations depend on later phases. | Build order fixed in section 5; simulated decisions run after precompute. |
| X23 | P1 | 13 | Scope leaves no integration buffer. | Tier 1 must-ship scope and Tier 2 cut order (13). |
| X24 | P2 | 5 | Reseeding can overwrite live history; previews could share data. | `--target`, refusal without `--force`, separate preview database branch (5, 11). |
| X25 | P2 | 3, 10 | Existing scaffold should be extended, not rebuilt; banner names the audience; provider switching has no tested contract. | Scaffold extended; banner neutral; only the default provider is claimed as tested (3, 10). |

## Accepted risks

- Simulated analyst decisions are generated from the same labels the checks are
  evaluated on. They exist to make the agreement view usable on day one and are
  always shown as a separate cohort.
- Snapshot integrity is tamper-evident against casual edits only. Production
  needs external anchoring or WORM storage (stated on the Replay tab).
- Groq free-tier limits are taken from the provider's public documentation and
  must be re-checked before the production precompute.
