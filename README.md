# Invoice Check

Prototype invoice verification tool for an invoice finance lender. Deterministic
checks flag risky invoices in a funding batch, an LLM agent explains each flag
with cited evidence, a validator rejects any explanation it cannot back up, and
a credit analyst makes every decision.

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

Setup, architecture diagram, evaluation results and the "What production would
need" section land with Phase 5.
