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
- Money is integer cents; dates are ISO strings in NZ time.
- No secrets. No real company names or logos; Runway appears only as the
  named audience, in text, never as a logo or brand asset.
- Any LLM output path goes through Zod and the citation validator.
- Significant design choices get an ADR in `docs/adr/`.

## Labels

| Prefix | Values |
| --- | --- |
| `type:` | feature, bug, task, docs, chore |
| `area:` | data, checks, agent, eval, ui, security, infra, docs |
| `priority:` | P0 (blocks the demo), P1 (needed for done), P2 (nice to have) |
| `phase:` | 0 to 5, plus `deploy` |

## Scope cuts

If a phase slips, cut scope, not the date. Cut order: Re-run agent button, dark
theme, then lower-value checks. The Evaluation page is never cut.
