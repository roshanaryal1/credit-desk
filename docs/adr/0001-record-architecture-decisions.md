# 0001. Record architecture decisions

- Status: accepted
- Date: 2026-10-23

## Context

Design choices in this project (detection strategy, LLM provider, data model)
need to be explainable to reviewers who were not in the room.

## Decision

Record significant decisions as short ADRs in `docs/adr/`, numbered in order,
using `0000-template.md`. An ADR is added in the same pull request as the
change it describes.

## Consequences

Reviewers can trace why the system looks the way it does. Superseded decisions
stay in the log with a pointer to the replacement.
