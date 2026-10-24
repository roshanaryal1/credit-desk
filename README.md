# Credit Desk

A prototype credit operations desk for invoice finance. Deterministic checks
flag risky invoices before funding, watch rules track the funded book, an LLM
agent explains each flag and has to cite the records behind every claim, a
validator rejects anything it cannot ground, and an analyst makes every
decision. A Trust Panel measures how often the agent agrees with analysts who
decided without seeing it, and replays any decision exactly as it was made.

> Prototype for discussion. All data is synthetic.

**Rules detect, the model explains, a validator checks the model, and a person
decides.** The agent never approves, funds or changes anything.

## Credit Desk 2.0 — combined synthetic review candidate

> **Status: integrated synthetic prototype, not a production lending application.**
> Credit Desk v2 was integrated into `main` through PR #136 on 25 October 2026.
> Live banking, enterprise tenant authentication, payments and policy sign-off
> remain out of scope and require a separate controlled release.

The review branch expands the original invoice-finance prototype:

| User journey | Review route | Scope and verification limit |
| --- | --- | --- |
| Institutional workbench | `/` | Synthetic exposure and attention priorities |
| Analyst review queue | `/queue` | Read-only invoice and incident triage; no verified owner or checker session |
| Client 360 | `/clients` → client | Synthetic facilities, debtors, dated collections and risk history |
| Client-specific collateral scenario | `/clients/cli_0001/borrowing-base` | Reconciles *that client's synthetic ledger* to invoice-level haircuts; **not drawable funding** |
| Formula demonstration | `/borrowing-base` | Separate hand-worked hypothetical cases for finance policy review |
| Credit assessment drafts | `/credit-memos` | Only evidenced amounts, explicit missing facts; no signature or auto-approval |
| Trust and audit | `/trust`, `/audit` | Existing shadow comparison, historic decision replay and audit records |

Additional server-side foundations include a durable source-event journal, leased
and fenced retry/dead-letter state, client-scoped authorization policy, and
transactional case history with maker-checker separation. **These foundations
are not automatically active production workflows:** an external verified
identity provider, server-side role enforcement, real provider consent and
operator-run production monitoring are still required.

### Choose a demo perspective

The shared-password demonstration now supports five **self-selected, fictional**
perspectives: **Employer / lender**, **Credit analyst**, **Credit checker**,
**Client / borrower**, and **Auditor**. These are not verified identities or
production RBAC. The client view shows one fixed synthetic borrower's summary;
only the analyst demo can record existing synthetic decisions. Signing out
allows selecting a different perspective. For controls, limitations and review
steps see [docs/review/demo-personas.md](docs/review/demo-personas.md).

### How to review without deploying

The optional `Review UI smoke (synthetic only)` GitHub Actions workflow
starts a disposable locally seeded production-mode server with fresh temporary
login credentials, visits the synthetic review routes on desktop and mobile,
and uploads *actual captured screenshots* plus a test manifest as a temporary
workflow artifact. Its successful run is evidence of route rendering, not
credit-policy approval, a full accessibility audit, or bank-grade security.

For implementation provenance, dependency order, known gaps and the
one-pass review checklist, see
[`docs/review/integrated-acceptance.md`](docs/review/integrated-acceptance.md)
and GitHub issues #99 and #135. The original v1 screenshots below remain
historic examples and are not the full v2 visual acceptance evidence.

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Run it locally](#run-it-locally)
- [Evaluation](#evaluation)
- [Limitations](#limitations)
- [What production would need](#what-production-would-need)
- [Project docs](#project-docs)

## Screenshots

| | |
| --- | --- |
| ![Overview](docs/screenshots/overview.png) | ![Batch in shadow mode](docs/screenshots/batch-shadow.png) |
| Overview: facility use, waiting batches, open incidents, agreement | Invoice Check in shadow mode: the agent's view is withheld until the analyst decides |
| ![Explanation revealed](docs/screenshots/invoice-revealed.png) | ![Replay](docs/screenshots/replay.png) |
| After the decision: the explanation with numbered evidence, and whether the analyst agreed | Replay from the frozen snapshot, with checksum and chain status |
| ![Trust Panel](docs/screenshots/trust-agreement.png) | ![Portfolio Watch](docs/screenshots/watch.png) |
| Agreement, kappa, confusion matrix and disagreements (simulated cohort) | Portfolio Watch with an explained High incident |

## What it does

| Part | What an analyst sees |
| --- | --- |
| Overview | Funds in use against each facility, batches waiting for review |
| Invoice Check | Batch summary (face value, flagged value, fundable amount on a double rule), debtor concentration, an invoice table, and an invoice panel with the checks that fired, the agent's explanation with numbered evidence, and Approve, Hold or Reject |
| Portfolio Watch | A date stepper over 90 days of history; incidents appear as debtors slow down, credit notes hit funded invoices, invoices go overdue, or concentration rises; Acknowledge or Resolve with a note |
| Trust Panel | Agreement (shadow mode only, with kappa, confidence intervals, a confusion matrix and disagreements), Evaluation (precision and recall per check and rule, agent metrics) and Replay (render a decision from its frozen, checksummed snapshot) |
| Audit log | Every decision and incident action, newest first, append-only |

## Architecture

```mermaid
flowchart LR
  subgraph Sources["Synthetic sources (Xero- and Akahu-shaped)"]
    L[Ledger and credit notes]
    B[Bank receipts and allocations]
    P[Debtor payments]
  end
  subgraph Lender["Lender records"]
    I[Batches and invoices]
    F[Fundings and repayments]
  end
  Sources --> C[Checks<br/>11 pure rules, as of submission]
  Lender --> C
  Sources --> W[Watch rules<br/>5 pure rules, as of each day]
  Lender --> W
  C --> FN[(Findings)]
  W --> INC[(Incidents)]
  FN --> A[Agent<br/>read-only tools, 6 calls, 30 s]
  A --> V{Citation validator}
  V -- passed --> E[(Explanations)]
  V -- failed twice --> X[Raw findings only]
  FN --> UI[Analyst UI]
  E --> UI
  INC --> UI
  UI -- decision --> T[One transaction:<br/>decision + canonical snapshot<br/>+ SHA-256 chain + audit event]
  T --> TP[Trust Panel:<br/>agreement, evaluation, replay]
```

| Layer | Where | Notes |
| --- | --- | --- |
| Checks | `lib/checks/` | Pure functions, thresholds in `config.ts` with `CONFIG_VERSION`; context built as of the submission date (ADR 0006) |
| Watch | `lib/watch/` | Pure functions over the book as of a date; idempotent runner with incident lifecycle |
| Agent | `lib/agent/` | OpenAI-compatible client (Groq by default), scoped tools, `submit_explanation` tool, citation validator, versioned prompts (ADR 0002, 0003) |
| Trust | `lib/trust/` | Shadow-mode eligibility, kappa and Wilson intervals, canonical-JSON snapshots with a hash chain (ADR 0004, 0005) |
| Data | `lib/db/`, `lib/seed/` | Drizzle schema with append-only triggers; deterministic 90-day generator with reference labels |
| App | `app/`, `components/` | Next.js 16 App Router, Tailwind, shadcn/ui; password gate in `proxy.ts` |

## Run it locally

Requirements: Node 24 (see `.nvmrc`). No database server is needed locally:
with `DATABASE_URL` empty the app uses PGlite, an in-process Postgres, stored in
`.pglite/`.

```bash
npm ci
cp .env.example .env.local          # then fill in the values below
npm run seed -- --target=local      # data, checks and 90 days of watch runs
npm run precompute                  # agent explanations (needs LLM_API_KEY; about a minute per item; Groq's free tier allows about 28 per model per day)
npm run simulate                    # simulated past decisions for the agreement history
npm run dev
```

| Variable | Needed for |
| --- | --- |
| `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | Precompute and the Re-run agent button |
| `DEMO_PASSWORD`, `SESSION_SECRET` (32+ characters) | The password gate; without them the gate is off in development and the app refuses to serve in production |
| `DATABASE_URL` | Neon in production; leave empty locally |
| `CRON_SECRET` | Optional daily watch run at `/api/watch/run` |

Quality checks (all run in CI):

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build && npm run check:bundle && npm run eval
```

## Evaluation

`npm run eval` builds two synthetic datasets in memory, a development seed and
a holdout seed with different parameters, runs every check and watch rule, and
scores them against labels. It writes `eval/report.json`, which the Evaluation
tab renders. CI fails if any check's precision or recall on the holdout seed
drops below its configured minimum.

| | Development | Holdout |
| --- | --- | --- |
| Invoices (labelled with a problem) | 251 (38) | 237 (42) |
| Checks: precision and recall, all eleven | 1.00 and 1.00 | 1.00 and 1.00 |
| Watch rules: precision and recall, four with positives | 1.00 and 1.00 | 1.00 and 1.00 |

Agent metrics come from the stored precompute runs (CI never calls the model)
and are shown on the Evaluation tab: validator pass rate, schema pass rate,
citation validity, amount and date faithfulness, retry rate, tokens and time.

How to read these numbers: labels and checks both encode the specification, so
perfect scores show the code implements the rules as written. They do not show
the rules catch real fraud. The validator proves that citations exist and that
figures match the cited records; it does not prove the reasoning is right.

## Limitations

- All data is synthetic. There is no connection to Xero, Akahu or any real
  system.
- Thresholds are the specification's defaults, not calibrated on real losses.
- Simulated analyst decisions are derived from the evaluation labels. They
  exist to show the agreement view and are kept in a separate cohort.
- Sign-in is a shared password with a self-declared name, so attribution in
  the audit log is not authenticated.
- Snapshot checksums detect accidental or casual changes. They do not stop
  someone with full database access.
- The LLM runs on Groq's free tier, which is acceptable only because the data
  is synthetic.

## What production would need

- Real authentication with roles and maker-checker approval.
- Xero and Akahu integrations under the relevant accreditation.
- Immutable audit storage with snapshot hashes anchored outside the database.
- Data retention and access under the Privacy Act 2020, and AML/CFT
  considerations.
- Threshold calibration on real loss data, with monitoring and alerting.
- A provider and data-residency review before any real customer data reaches a
  model.

## Project docs

- [SPEC.md](SPEC.md): product and technical specification
- [docs/reviews](docs/reviews): design review and how each finding was resolved
- [docs/adr](docs/adr): architecture decision records
- [docs/deploy.md](docs/deploy.md): deploying to Vercel and Neon
- [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md)
