# Credit Desk: project rules

SPEC.md is the source of truth. If a change conflicts with it, update SPEC.md in
the same pull request or stop and ask. ADRs in `docs/adr/` record why.

## Non-negotiables

- TypeScript `strict`. No `any` without a comment explaining why.
- Money is integer cents; rates are integer basis points. All amounts NZD.
  Round per invoice, then sum. Format only at the UI edge.
- Business dates are `YYYY-MM-DD` in `Pacific/Auckland`; instants are UTC
  `timestamptz`. Use `DEMO_TODAY` from config, never the wall clock, in
  business logic.
- No look-ahead: checks, watch rules and agent tools only see records effective
  on or before their as-of date.
- Synthetic data only. No real company names, people, NZBNs or logos in code,
  seed data, fixtures, screenshots or docs. The only named organisation is the
  one About-page line allowed by SPEC section 10.
- Checks (`lib/checks/`) and watch rules (`lib/watch/`) are pure functions, one
  file each, thresholds only in config with a comment per default, each with
  positive, negative and edge-case tests. Watch runs are idempotent.
- Every LLM output is parsed with Zod and passed through the citation
  validator before it is stored or shown. The validator is the guarantee, not
  the provider.
- The agent is read-only. It never approves, funds or changes anything.
- In SHADOW mode the server never sends agent output before the decision.
- A decision, its snapshot and its audit event are written in one transaction.
  Snapshots are canonical JSON stored as text with a SHA-256 chain.
  Append-only tables are never updated or deleted.
- Secrets only in environment variables. Modules that read secrets import
  `server-only`. Never use `NEXT_PUBLIC_` for a secret. Never log secrets.
- Validate every external input (route params, form bodies, tool arguments)
  with Zod at the boundary.

## Working agreement

- Every change: issue, branch `<type>/<issue>-<slug>`, PR, independent review,
  squash-merge. Conventional Commits. See CONTRIBUTING.md.
- Before pushing: `npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build`.
  Run `npm run eval` when checks, watch rules, data or the agent change.
- Significant design decisions get an ADR in `docs/adr/`.
- Prototype, not production: prefer the simplest thing that is correct and
  testable. Do not over-engineer.
- Repository text is professional and product-focused.
