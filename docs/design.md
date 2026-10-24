# Credit Desk — Institutional Ledger design standard

Status: **Working design proposal**, implemented initially on the v1 overview.  
Issues: #110 and programme #99. This design does not imply the product is ready for real financial data.

## Positioning

An understated credit-operations workbench designed for analysts, risk managers and independent checkers. Visual confidence must come from **correct numbers, traceable evidence and clear decisions**, not gradients, glassmorphism, stock imagery, ornamental charts or AI-chat widgets.

## Colour tokens

| Role | Light value | Usage |
| --- | --- | --- |
| Canvas | `#f7f6f2` | Warm paper surface; separates application chrome from records |
| Card | `#fffefa` | Readable neutral table/record panels |
| Ink | `#1b2b29` | Primary text, strong contrast |
| Forest | `#205343` | Primary action, active navigation, section eyebrow |
| Border | `#dbddd5` | Delineation without heavy card shadows |
| Muted | `#53625d` | Secondary explanation and source metadata |
| Risk | Existing red/amber status tokens | Use **only** for meaningful exception states |

Dark mode retains dedicated ink-based tokens and must receive the same contrast/keyboard review. Do not use fake gold gradients or non-semantic colour badges.

## Hierarchy and composition

1. Global navigation has a quiet brand header and explicit **Work / Assurance** groups. Incomplete future modules must not appear as fake functioning navigation links.
2. First screen is **position → action → monitoring → exposure → assurance**. Each financial value has an as-of/business context.
3. Monetary figures use tabular numerals, NZD formatting and right-aligned table columns. Never present commitment headroom as drawable availability.
4. Panels prefer fine borders and whitespace over shadows; section eyebrows are small uppercase, primary headings are strong but restrained.
5. Risk severity must always include text; do not communicate decisions by colour alone.
6. Every actionable item must link to real records and make sense when the dataset is empty or stale.
7. When a source does not provide yesterday's position, **don't fabricate movement**. Explain what data is unavailable.
8. AI is rendered as source-cited analyst assistance. Never show decorative confidence scores or claim verified automation accuracy from synthetic labels.

## Interaction and accessibility bar

- Tested at 390px mobile and 1440px desktop; dense finance tables must stay usable without hiding numeric meaning.
- Keyboard navigation, visible focus and reduced motion. Aim for WCAG 2.2 AA contrast and semantic headings/landmarks.
- Show explicit loading, error, empty, ineligible and stale states.
- Links on metrics lead to supporting detail and reconciled inputs; fake call-to-action links fail review.
- Header and footer keep the **synthetic prototype** disclosure in every environment.
- High severity is for real deterministic flags in the synthetic dataset, not visual decoration.

## Scope and follow-ups

This workbench uses **existing** queries for exposure, facility headroom, pending batches, incidents and evaluated agent agreement. It does not implement #102 borrowing-base availability, #105 ownership, #103 client relationships or #104 ageing. Those require independently tested domain layers before additional headline KPIs can be safely added.

The source-level design tokens are in `app/globals.css`, navigation in `components/nav.tsx`, and the workbench in `app/page.tsx`.

### Visual acceptance checklist

- [ ] Desktop screenshot at 1440px and mobile at 390px on a real rendered app
- [ ] Side-by-side comparison with prior dashboard
- [ ] Accessibility review and keyboard-only user journey
- [ ] Risk/synthetic provenance wording independently reviewed
- [ ] Zero-data and high-risk demo cases manually checked
- [ ] All linked counts and amount aggregates reconcile to existing queries

No screenshots are added until the actual UI is rendered and captured; do not supply imaginary imagery as evidence.
