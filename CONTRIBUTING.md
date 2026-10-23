# Contributing

## Workflow

1. Every change starts from an issue. Use the issue templates (feature, bug,
   task). Each issue belongs to a phase milestone and carries `type:`, `area:`
   and `priority:` labels.
2. Branch from `main` using `<type>/<issue-number>-<short-slug>`, for example
   `feat/12-duplicate-check` or `fix/31-cents-rounding`.
3. Keep each pull request to one logical change. Link the issue with
   `Closes #<n>` in the description.
4. CI must be green before merge. Squash-merge into `main`; the squash title
   follows Conventional Commits.
5. Delete the branch after merge.

`main` is always deployable. Nobody pushes to `main` directly after the initial
bootstrap commits.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `perf:`, `chore:`, `ci:`.
Optional scope matches an `area:` label, for example `feat(checks): add DUP check`.

## Local checks (run before every push)

```bash
npm run typecheck
npm run lint
npm run test
npm run format:check
npm run build
```

`npm run eval` runs the evaluation once data and checks exist (Phase 2 onward).

## Definition of done for a pull request

- Behaviour matches SPEC.md, or SPEC.md is updated in the same PR.
- Tests cover the normal path, a failure path and an edge case.
- Money is integer cents; business dates are `YYYY-MM-DD` in NZ time;
  instants are UTC.
- Decision, snapshot and audit event are written in one transaction.
- No secrets, no real company names or logos. The only named organisation is
  the one About-page line allowed by SPEC section 10.
- Any LLM output path goes through Zod and the citation validator.
- Significant design choices get an ADR in `docs/adr/`.

## Labels

| Prefix | Values |
| --- | --- |
| `type:` | feature, bug, task, docs, chore |
| `area:` | data, checks, watch, agent, trust, eval, ui, security, infra, docs |
| `priority:` | P0 (blocks the demo), P1 (needed for done), P2 (nice to have) |
| `phase:` | 0 to 7, plus `deploy` |

## Scope cuts

If a phase slips, cut scope, not quality. Follow the Tier 2 cut order in SPEC
section 13. The Trust Panel and the evaluation are never cut.
