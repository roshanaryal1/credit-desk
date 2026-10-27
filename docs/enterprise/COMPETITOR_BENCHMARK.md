# Competitor benchmark

Research date: 2026-10-27. Competitor capabilities below are limited to what the cited public pages state. A blank means "not stated on the page reviewed", not "absent from the product".

## 1. Credit Desk's market and boundaries

From `SPEC.md` sections 1, 2 and 14 and the implemented code, Credit Desk is **an invoice-finance (receivables lending) operations workbench for a New Zealand lender**. It covers:

- invoice verification for funding batches, through deterministic checks with evidence;
- borrowing-base availability against eligible receivables;
- portfolio monitoring through daily watch rules and incidents;
- evidence-cited AI explanations that never decide.

It is **not** loan origination (application intake, spreading, underwriting), **not** a core lending or servicing system (interest, fees, payments), and **not** accounts-receivable management for a corporate's own receivables (dunning, cash application). These neighbouring markets explain why some competitor features are out of scope.

## 2. Products reviewed

| Product | Category | Source | Retrieval |
| --- | --- | --- | --- |
| nCino Commercial Lending | Bank commercial loan origination and portfolio | https://www.ncino.com/solutions/commercial-lending | Fetched 2026-10-27 |
| Finley | Debt capital and credit facility management (lender and borrower side) | https://www.finleycms.com/platform/overview | Fetched 2026-10-27 |
| HighRadius Credit and Collections | Corporate AR credit risk and collections | https://www.highradius.com/product/credit-and-collections/ | Fetched 2026-10-27 |
| Solifi Asset-Based Lending | ABL and receivables lending servicing | https://www.solifi.com/asset-based-lending-software/ | **Official page returned HTTP 403** to automated retrieval. Secondary sources only, mostly dated 2022 (see below) |

Solifi secondary sources (dated, industry press and directories), to be confirmed against the official page:

- https://www.abladvisor.com/industry-directory/service-providers/321/solifi
- https://www.equipmentfa.com/news/35265/solifis-latest-abl-release-enhances-real-time-portfolio-visibility-and-risk-management-controls (2022 release)
- https://platform.softwareone.com/product/asset-based-lending/PCP-0048-1715

## 3. Stated competitor capabilities

**nCino (official page):** "streamlined commercial loan origination system"; "specialized workflows"; AI-powered financial spreading; "integrated document repository … visual audit trail"; covenant due-date notifications; "early warning signals"; real-time portfolio reporting; "loan reports" for regulators and auditors; "automation, generative, and agentic AI". Underwriting approvals and integrations are not described on the page.

**Finley (official page):** "Automated calculations of borrowing bases, interest accrual, and waterfall payments"; covenant management and portfolio monitoring; "Configurable alerts and reports"; "Digital Credit Agreement that turns loan terms into structured data"; templated DOCX/XLSX for funding requests; scenario modelling "for different funding actions"; integrations with "core banking systems, loan management systems"; open-format export.

**HighRadius (official page):** AI credit scoring of applicants, "35+" credit agencies (elsewhere "40"), digital credit application, suggested credit limits, blocked-order prediction, prioritised collections worklists, dunning, dispute flags, AI agents, dashboards for DSO, bad debt and credit exposure, "50+ ERPs" integrations. Vendor outcome claims (for example "20% Reduction in Past Due") have no stated methodology and are excluded.

**Solifi (secondary, unverified against official page):** loan management; credit monitoring comparing borrowing base with asset base; automated collateral values, ineligibles, advance rates and line limits; near real-time AR ageing comparisons (2022 release); borrower portal; portfolio analytics.

## 4. Scoring rubric

| Score | Meaning |
| --- | --- |
| 0 | Absent |
| 1 | Designed or library code only; not usable by a user |
| 2 | Usable on synthetic data with significant gaps or manual workarounds |
| 3 | Complete for the core path on synthetic data, verified end to end; not production-integrated |
| 4 | Production-ready for a pilot: real identity, real data integration, operational controls |
| 5 | Market-leading, with configurable policy, integrations, scale evidence and customer use |

Credit Desk scores below use this audit's evidence. Competitor columns show only "stated" (S) or "not stated on page" (blank). A score is not given for competitors, because public marketing pages are not evidence of quality.

## 5. Comparison matrix

| Capability | Relevance to Credit Desk | Credit Desk | Evidence | nCino | Finley | HighRadius | Solifi (secondary) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Invoice-level verification checks with evidence | Essential | 3 | 11 tested rules; eval precision/recall | | | | |
| Borrowing-base calculation (eligibility, concentration, advance, reserves) | Essential | 3 | Oracle-verified; policy values not approved | | S | | S |
| Funding decision record with audit and replay | Essential | 3 | Snapshot chain, replay; PR #198 closes stale-fact gap | S (audit trail) | | | |
| Maker-checker approval | Essential | 1 | Library only (#105) | | | | |
| Portfolio monitoring and alerts | Essential | 3 | Watch rules, incidents, trends | S | S | S | S |
| Covenant monitoring | Important | 0 | Not built | S | S | | |
| Debtor ageing and collections risk | Important | 3 | Client collections view, ageing | | | S | S |
| Facility and drawdown management | Important | 1 | Library only (#107, #108) | | S | | S |
| Document repository | Important | 0 | Not built; evidence comes from ledger and bank records | S | S (data repository) | | |
| Borrower portal | Optional (later) | 2 | Read-only fictional snapshot | | | | S |
| Accounting and bank integrations | Essential for production | 1 | Xero/Akahu adapters with fixtures only (#106) | | S | S | |
| Identity, roles, MFA | Essential for production | 1 | Shared password plus self-selected persona (#109) | | | | |
| Reporting and export | Important | 3 | Portfolio pack with digest, memo export | S | S | S | |
| AI explanation with citation validation | Differentiator | 3 | Validator authoritative; hardening in #186, #204 | S (AI, no validation claim) | | S (AI agents) | |
| Credit scoring of new debtors | Optional | 0 | Out of scope; new-debtor check only | | | S | |
| Dunning and cash application | Out of scope | 0 | Different market (corporate AR) | | | S | |
| Loan origination and spreading | Out of scope | 0 | Different market | S | | | |

## 6. What Credit Desk needs to compete in its category

1. **Essential, market-standard:** real identity and roles (#109); maker-checker approvals (#105); real ledger and bank ingestion (#100, #106); approved, versioned eligibility and concentration policy (#101, #102); covenant and facility terms as data (#108).
2. **Important competitive improvements:** a document repository tied to cases, configurable alerts and escalation, facility and drawdown ledger (#107), and exportable funding packs.
3. **Optional enterprise:** a borrower portal with uploads, debtor credit data feeds, and multi-entity reporting.
4. **Low value or distraction for now:** dunning, cash application, origination and spreading. These belong to adjacent products.

**Differentiation opportunity:** the competitors reviewed market AI broadly. None of the pages reviewed claims machine-checked citation of every AI statement against source records with a fail-closed validator. That is Credit Desk's clearest distinctive capability, provided #186 and #204 merge and the claim is stated precisely.
