# Credit Desk 2.0 — programme charter and execution plan

**Status:** Proposed for review — not an approved modification to the v1 specification, not an implementation completion claim.  
**Programme:** [#99](https://github.com/roshanaryal1/credit-desk/issues/99)  
**Baseline:** The current synthetic-data Credit Desk application on main; existing capabilities, Trust Panel and evaluation gates must remain intact.  
**Audience:** Product owner, lending domain reviewer, engineering, UX, security/assurance and demo stakeholders.

## 1. Executive intent and investment case

Evolve Credit Desk into an **evidence-first credit operations workbench** that looks and behaves like carefully designed institutional lending software. The core value proposition is better analyst judgment, faster exception handling, defensible funding calculations and visible ownership — not an AI chatbot or automated lending approval.

Target journey: a reviewer identifies urgent work, opens a client, verifies the receivables and facility position, examines source-backed risks, prepares a decision and sends it through appropriate human approval. Monitoring, audit and evaluation cover the full journey.

### Outcome measures (targets; baselines to establish in W0)

- Financial integrity: 100% parity with independently prepared golden borrowing-base worksheets; zero unexplained amount differences.
- Decision traceability: every computed adjustment and final human decision can be traced to dated source evidence and an audit/replay reference.
- Control effectiveness: no cross-client/role access in negative tests; maker and checker cannot be the same verified identity where dual approval is required.
- Analyst efficiency: measure median time to triage and finish five scripted cases before/after redesign; select an improvement target only after measuring baseline.
- UX accessibility: review against WCAG 2.2 AA where applicable; keyboard-only and 390px/1440px acceptance of key journeys.
- Operational reliability: idempotent import, watch and workflow runs; recoverable failures and explicit stale-data indication. Establish performance and latency budgets from realistic fixtures, not guessed production claims.
- Model honesty: no AI-generated numeric calculation enters the borrowing-base engine; unsupported narrative claims fail validation; draft memos require human review.

### Non-goals for the initial v2 release

No real-money transfers, automated credit decisions, live lending underwriting claims, unapproved access to bank accounts, production rollout for customer data, unverified regulatory-compliance claims, or premature multi-product lending support. W5 issues remain future options until separately authorized.

## 2. Work register: unique owner of each deliverable

### Engineering capabilities (G)

- **G01 [#100](https://github.com/roshanaryal1/credit-desk/issues/100):** ingestion contracts, refresh/replay, provenance, checkpointing.
- **G02 [#101](https://github.com/roshanaryal1/credit-desk/issues/101):** versioned risk policy, escalations, trends.
- **G03 [#102](https://github.com/roshanaryal1/credit-desk/issues/102):** deterministic borrowing-base / availability calculation.
- **G04 [#103](https://github.com/roshanaryal1/credit-desk/issues/103):** unified client/facility/activity read models.
- **G05 [#104](https://github.com/roshanaryal1/credit-desk/issues/104):** debtor ageing and payment intelligence.
- **G06 [#105](https://github.com/roshanaryal1/credit-desk/issues/105):** workflow state machine, ownership, SLAs and independent checker.
- **G07 [#106](https://github.com/roshanaryal1/credit-desk/issues/106):** consent-based Xero/Akahu sandbox integrations (future).
- **G08 [#107](https://github.com/roshanaryal1/credit-desk/issues/107):** drawdown journal, disbursement controls and reconciliation (future; dry-run default).
- **G09 [#108](https://github.com/roshanaryal1/credit-desk/issues/108):** revolving and term credit facility abstractions (future).
- **G10 [#109](https://github.com/roshanaryal1/credit-desk/issues/109):** authenticated identity, RBAC, MFA, observability and security.

### User-facing initiatives (I)

- **I01 [#110](https://github.com/roshanaryal1/credit-desk/issues/110):** executive workbench; uses G02, G03, G05, G06, G10.
- **I02 [#111](https://github.com/roshanaryal1/credit-desk/issues/111):** Client 360 dossier; uses G03, G04, G05, G10.
- **I03 [#112](https://github.com/roshanaryal1/credit-desk/issues/112):** borrowing-base calculator/waterfall UI; uses G03, G04, G10.
- **I04 [#113](https://github.com/roshanaryal1/credit-desk/issues/113):** analyst case queue and checker inbox; uses G02, G06, G10.
- **I05 [#114](https://github.com/roshanaryal1/credit-desk/issues/114):** evidence-grounded credit assessment memo; uses G03–G06, G10 and existing explanation validation.

**Boundary:** G issues own domain logic, contracts, security and reusable server capabilities. I issues own interaction, composition, usability and end-to-end UAT. No second borrowing-base implementation inside I03, no second case state machine inside I04 and no independent data model inside I02.

## 3. Architecture strategy

Keep a **modular TypeScript/Next.js monolith with PostgreSQL** initially rather than creating microservices. Introduce named module boundaries: source-ingestion, receivables, client/facility, credit-policy, borrowing-base, debtor-intelligence, case-workflow, watch, memo-drafting, identity and audit. Each domain exposes typed server-only interfaces and a clear testing seam.

- Source connectors map data to canonical contracts with source IDs, effective date, observed date, ingestion event IDs, connection health, and unknown/stale states.
- Financial engines run pure deterministic calculations using integer NZD cents, basis points and explicit business as-of dates. Rounding and deduplication rules are versioned and covered by independent worksheets.
- Policy changes are versioned, dated, authorized and reproducible when replaying historic decisions.
- Workflows use a server-enforced state machine with idempotency tokens, optimistic concurrency/locking where appropriate, and a single transactional audit outcome.
- UI consumes reconciled read models; every headline metric opens its underlying evidence and reveals source freshness.
- LLM has read-only access to authorized evidence and may draft text with citations. It cannot calculate authoritative availability, authorize a funding or execute disbursement.
- Enforce least-privilege OIDC + MFA for privileged roles before any real-source pilot. Keep existing password-only access as explicitly labelled synthetic demo mode, not a production-data identity system.
- Postgres remains the system of record; do not introduce an event bus, search cluster, vector database or warehouse until data volume and operational need justify them.

### Required ADR decisions before implementation

1. Canonical as-of and source-provenance model, plus incremental reconciliation strategy (G01).
2. Borrowing-base waterfall policy, precedence, facility terms and treatment of negative/unavailable data (G03).
3. Workflow states, actor separation, immutable journal and transactional boundaries (G06).
4. OIDC provider, tenant boundaries, MFA and audit retention (G10).
5. Real-source consent, secrets, data residency and operational rollback before G07.
6. Real-money disbursement authorization and bank settlement controls before G08.
7. Product-specific facility modelling before G09.

Each decision records options, rejected alternatives, consequences and reversal cost. Changes to new functional scope require an accompanying SPEC.md PR because SPEC.md is the project's authoritative specification.

## 4. Sequenced work plan and exit gates

### W0 — Product, design and assurance foundation

- Walk through five synthetic credit cases and document current task timing, screenshots, friction, state gaps and performance baseline.
- Map analysts, checker, risk manager and auditor journeys; decide what the first v2 release explicitly will and will not do.
- Establish visual tokens, component examples, information architecture, data/UX terminology and reviewable wireframes. Start with the workbench and invoice panel.
- Review ADRs, amend SPEC through a dedicated PR and accept explicit feature boundaries. Select security/hosting posture for synthetic previews.
- **Exit gate:** reviewed design brief, clickable flow or high-fidelity wireframes, agreed data contract, financial formula specification and engineering decision register. No large production UI rewrite before this gate.

### W1 — Identity, source contracts and workflow kernel

- Build G10 #109 role matrix and negative-access tests, then G01 #100 ingestion contract/idempotency/freshness primitives.
- Begin G06 #105 case storage, ownership and transition API behind role and feature gates.
- Preserve existing seeded application and as-of replay. Demonstrate safe rollback and no cross-client reads.
- **Exit gate:** critical permission tests pass; synthetic ingest/replay is deterministic; audit events include verified identity or explicitly synthetic actor context.

### W2 — Credit financial and relationship foundation

- Implement G03 #102 as a pure borrowing-base function with golden, independently hand-calculated fixtures and explainable exclusions.
- Implement G04 #103 client/facility and timeline read models; G05 #104 ageing and debtor payment trends.
- Complete invariants, source reconciliation, no-look-ahead tests, data freshness, large-fixture query benchmark and signed-off example outputs.
- **Exit gate:** five manually verified portfolio scenarios reconcile cent-for-cent and every figure drills into the source record.

### W3 — Institutional daily operations experience

- Deliver I01 #110 executive workbench and I02 #111 Client 360 using W2 read models.
- Deliver I03 #112 borrowing-base waterfall experience and I04 #113 actionable queue/checker inbox using G06 controls.
- Extend G02 #101 versioned risk policy, assignment/escalation and history in the watch experience.
- Implement status-specific empty/error/stale states and mobile/keyboard UAT, and compare UI screenshots against the approved visual standard.
- **Exit gate:** reviewer can trace a flagged invoice → client → borrowing base → case → checker decision → audit/replay without leaving the application or encountering a dead-end.

### W4 — Credit memo, polish and release assurance

- Deliver I05 #114 with deterministic evidence extraction, reference index, narrative validator, revisions, draft watermark and human sign-off.
- Perform walkthrough and independent review on financial correctness, privacy, role separation, accessibility, UX consistency and operational failures.
- Freeze a synthetic demonstration dataset; publish evaluation outcomes with sample sizes and limitations, not unsupported fraud-detection claims.
- **Exit gate:** UAT sign-off for five representative end-to-end cases, green CI and replay, security/financial review evidence, and documented known risks. No high-severity unresolved blocker at release.

### W5 — Optional controlled integrations and broader lending

- G07 #106 Xero/Akahu only after provider authorization, consent/privacy and security review.
- G08 #107 drawdown/disbursement starts as a closed-loop simulation; live money movement is separately approved and remains off by default.
- G09 #108 revolving/term modules have isolated feature flags, golden financial schedules and separate product acceptance.
- **Exit gate:** separate pilot-readiness approval per workstream; never inferred from W4 prototype release.

These waves are **dependency stages, not invented deadlines**. Each wave receives an owner, effort estimate, capacity plan, schedule and risk allowance at kickoff.

## 5. Design system — institutional, not 'AI slop'

**Creative position:** a modern private-credit analyst desk: sober, quietly premium, fast, high-density where appropriate, and genuinely explainable.

Design references should be evaluated for principles, not copied. Benchmark professional finance workflows and the typographic restraint of respected fintech products while avoiding a competitor's proprietary UI, brand assets or trade dress.

- Canvas: warm paper/stone neutrals with ink-dark text and one deep-forest action colour. Reserve amber/red for meaningful exception states.
- Type: purposeful hierarchy, carefully selected restrained sans-serif, tabular numerals, right-aligned amounts and an unambiguous NZD/unit convention.
- Layout: consistent 8px/4px rhythm, generous page-level whitespace, fine dividers, minimal borders, shallow elevation, fewer unrelated KPI cards.
- Tables: sort/filter/search, sticky meaningful columns only where tested, clear selection states, visible source dates and totals that reconcile.
- Finance: borrowing-base and ageing visuals only when they change decisions; expose the underlying worksheet and original transactions.
- AI: render as source-cited analyst note or memo draft, never floating chat bubbles, animated robot decorations or faux confidence percentages.
- Navigation: Work (Overview, Review Queue, Invoice Check, Risk Monitoring); Portfolio (Clients, Facilities, Analytics); Assurance (Trust & Audit). Guard unfinished modules behind feature flags.
- Accessibility: contrast, focus rings, reduced motion, non-colour status labels, keyboard escape/focus management and narrow-screen table strategy.
- Demonstrate screens with believable **synthetic** states: routine, high risk, stale feed, zero records, rejected approval, incomplete borrowing base and unresolved discrepancy.

**Design acceptance package for major UI PRs:** before/after screenshot at 1440px and 390px; states matrix; keyboard walkthrough; financial reconciliation sample; user journey outcome; explicit interaction copy.

## 6. Delivery management and control framework

### Roles (assignment pending)

- **Product owner:** prioritisation, intended workflow, risk acceptance, UAT sign-off.
- **Engineering lead:** architecture, implementation, CI evidence, change and rollback strategy.
- **Credit/finance SME:** independent review of borrowing-base formulas, policy terms, ageing and use of industry terminology.
- **Security/privacy reviewer:** threat model, identity/permission tests, integration and real-data gates.
- **Design/QA reviewer:** interaction quality, accessibility, regression and observable UAT.
- One contributor may cover several delivery roles in a prototype, but independent financial and security sign-off should precede use with real financial information.

### PR and issue mechanics

- One logical change per PR; branch from main using CONTRIBUTING.md naming; include Closes #number **only when that PR completes the full issue**. For incremental PRs use Ref #number without prematurely closing an epic.
- An initiative remains open until all linked capability dependencies and UAT criteria pass. Child work can be merged incrementally without closing a parent.
- PR body includes objective, before/after, data migrations and rollback, evidence screenshots, threat/privacy impact, tests and reviewer checklist.
- Required CI: typecheck, lint, format, tests, build, client-bundle secrets scan and current evaluation suite. Add golden finance fixtures, authorization matrix, accessibility and migration tests as modules are introduced.
- Keep protected or manually reviewed main; no direct pushes to main, no unrelated stacked PR merges.
- Organise issue review weekly by blocked, ready, in-progress, in-review and accepted. Track throughput and blockers, but never trade away audit or financial correctness to raise velocity.

### Decision gates

1. **Scope gate:** SPEC + ADR + design brief accepted before major implementation.
2. **Contract gate:** schema, data/permission invariants and test fixtures accepted.
3. **Quality gate:** CI, peer review, security, accessibility, source tracing and rollback passed.
4. **Product gate:** business user completes scenario without facilitator.
5. **Pilot gate:** separate consent, legal/security and operational approval for any real data or money movement.

## 7. RAID register (initial risks and responses)

- **R1 — Inaccurate borrowing base:** material financial impact. Response: golden fixtures, independent worksheet, versioned policy, fail closed on incomplete data; owner engineering + credit SME.
- **R2 — Cross-client data leakage:** sensitive data risk. Response: server-side deny-by-default authorisation tests; G10 precedes real integrations; owner security.
- **R3 — Stale accounting/bank feeds:** misleading fundable amounts. Response: effective/observed timestamp, freshness SLO, stale banner and refusal to present definitive availability; owner data.
- **R4 — AI explanations overstate certainty:** analyst trust risk. Response: evidence-bound schemas, source citations, validator, review-required marking; owner trust/QA.
- **R5 — Scope explosion:** programme stalls. Response: modular monolith, W4 v2 release boundary, W5 deferred; owner product.
- **R6 — Free-host limitations and background jobs:** demo interrupted. Response: local PGlite reproducibility, platform-specific workload tests, explicit hosting-cost decision; owner infra.
- **R7 — False implied regulatory or production readiness:** reputational risk. Response: synthetic watermark, documented limitations and approval gate; owner product/security.

Assumptions requiring confirmation: user roles, external provider sandbox access, exact funding policy terms, data retention, real-money roadmap, intended preview audience and available engineering capacity. None is silently treated as approved.

## 8. First practical PR sequence

1. **Programme PR:** this execution plan only; review ownership and scope.
2. **SPEC/ADRs PR:** approved v2 capabilities, security, finance and as-of contract; no feature code.
3. **Design foundations PR:** tokens, components, navigation shell, screenshot comparisons and story states; no invented financial numbers.
4. **G10 PR series:** OIDC/role boundaries, negative authorization tests, event tracing and audit identity.
5. **G01 PR series:** canonical events, replay, checkpoints, staleness, synthetic fixtures.
6. **G03 PR series:** formula ADR, pure engine, hand-worked golden tests, endpoints.
7. **G04/G05 PR series:** client and debtor reconciled read models.
8. **G06/G02 PR series:** case transitions, maker-checker rules, policies and escalation.
9. **I01–I04 PR series:** integrated daily operating desk with polished UX.
10. **I05 PR series:** source-cited memo, review process, exports and hallucination tests.
11. **Release candidate:** full synthetic UAT and independent assurance before declaring the programme's first deliverable complete.

## 9. Release, deployment and reporting

The existing v1 deployment/demo issues [#76](https://github.com/roshanaryal1/credit-desk/issues/76) and [#77](https://github.com/roshanaryal1/credit-desk/issues/77) remain separate; avoid blocking current prototype demonstration on W5 ideas.

Cost-conscious development default: local PGlite + synthetic fixtures. Assess free hosting and hosted Postgres separately only after confirming provider terms, ability to run necessary jobs, data persistence and user traffic. **Never use local ephemeral storage as the only production database.** No account signup, payment method or real banking connection is assumed or authorized by this plan.

A weekly programme report should contain: delivered PRs and acceptance evidence; planned next work; blockers/dependencies; risks/decisions; budget/hosting impact; and clear distinction between **coded**, **tested**, **deployed**, **validated with users**, and **approved for real data**.

## Review-only mode — explicit merge freeze

**Owner instruction (2026-10-24): Do not merge any Credit Desk v2 pull requests yet.** The team should implement, test, document and open reviewable PRs without changing `main`. This supersedes generic delivery advice above that would otherwise imply merging after each passing CI run.

- All new implementation PRs stay **draft and open** until they meet their *own* acceptance criteria. A passing CI run is necessary, not sufficient, for production or design sign-off.
- Related work may advance on independent branches, but identify exact dependency PRs and base SHA; don't pretend an independent base-main PR can compile against unmerged dependencies.
- Do not enable auto-merge, squash, rebase or direct-push on `main`; do not close child issues based on partial domain-only PRs.
- Keep proposed ADRs distinct from approved lending policy; real credentials, integrations, money movement, spend and releases require explicit additional authorization.
- When the product owner eventually lifts the freeze, conduct a combined integration review, order PRs by dependencies, re-run tests after each integration and close issues only after acceptance, deployed verification where relevant and documented sign-off.
- Every weekly status must separate **open PR with partial code**, **CI passed**, **UAT approved**, **merged**, **deployed**, and **production-eligible**. Do not collapse these states.

## 10. Administration still required

- GitHub milestones for the new programme must be created/assigned separately; the available connector does not expose milestone creation. Do not reuse old prototype milestone dates or meanings.
- Assign named accountable reviewers and approve the W0 success measures at programme kickoff.
- Reconcile older open issues #68, #73 and #74 with actual implementation and sign-off; do not silently close them by opening a new programme.
- Link the 15 programme issues to #99 and track their distinct dependencies, not duplicate task lists.

**Summary:** financial correctness and user trust are the product. Visual refinement expresses these properties rather than replacing them.
