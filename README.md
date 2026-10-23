# Credit Desk

A prototype credit operations desk for invoice finance. Deterministic checks
flag risky invoices before funding, watch rules track the funded book, an LLM
agent explains each flag with cited evidence, a validator rejects anything it
cannot ground, and an analyst makes every decision. A Trust Panel measures how
often the agent agrees with analysts in shadow mode and replays any decision
exactly as it was made.

> Prototype for discussion. All data is synthetic.

## Status

Under active development. See [SPEC.md](SPEC.md) for scope, the
[milestones](../../milestones) for delivery phases and the
[issues](../../issues) for work in flight.

## Docs

- [SPEC.md](SPEC.md): product and technical specification (source of truth)
- [CONTRIBUTING.md](CONTRIBUTING.md): branching, commits, pull requests, checks
- [SECURITY.md](SECURITY.md): secrets handling and reporting
- [docs/adr](docs/adr): architecture decision records
- [docs/reviews](docs/reviews): design reviews and how each finding was resolved

Setup, architecture diagram, evaluation results and the "What production would
need" section land with Phase 5.
