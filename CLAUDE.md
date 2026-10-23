# Invoice Check: project rules

SPEC.md is the source of truth. If a change conflicts with it, update SPEC.md in
the same pull request or stop and ask.

## Non-negotiables

- TypeScript `strict`. No `any` without a comment explaining why.
- Money is integer cents (`number` of cents, never floats of dollars). All
  amounts are NZD. Format only at the UI edge.
- Dates are ISO strings in NZ time (`Pacific/Auckland`). Date maths must be
  correct across NZST and NZDT.
- Synthetic data only. No real company names, people, NZBNs, logos, or lender
  branding anywhere: code, seed data, fixtures, screenshots, docs.
- Checks in `lib/checks/` are pure functions `(invoice, context) => Finding | null`,
  one file each, thresholds only in `lib/checks/config.ts`, each with positive,
  negative and edge-case tests.
- Every LLM output is parsed with Zod and passed through the citation
  validator before it is stored or shown. The validator is the guarantee, not
  the provider.
- The agent is read-only. It never approves, funds or decides. Analysts decide.
- Secrets only in environment variables. Server-only modules import
  `server-only`. Never use `NEXT_PUBLIC_` for a secret. Never log secrets.
- Validate every external input (route params, form bodies, tool arguments)
  with Zod at the boundary.

## Working agreement

- Work from an issue; branch `<type>/<issue>-<slug>`; one logical change per PR;
  Conventional Commits; squash-merge. See CONTRIBUTING.md.
- Before pushing: `npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build`.
  Run `npm run eval` when checks, data or the agent change.
- Significant design decisions get an ADR in `docs/adr/`.
- Prototype, not production: prefer the simplest thing that is correct and
  testable. Do not over-engineer.
