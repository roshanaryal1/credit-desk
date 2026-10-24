# ADR-0008: Event provenance, knowledge time and source freshness

Status: **Proposed / synthetic implementation only**  
Issue: #100; external integrations #106.

## Decision
Represent an imported source fact as a scoped provider observation: source kind, connection ID, client ID, immutable provider event ID, logical entity ID, effective business date, first-observed UTC instant and typed payload.

An **effective business date** answers when the underlying event applies; the **observed timestamp** answers when the desk learned of it. An auditable replay must honour both. Revision events are append-only; the most recently *known* revision of an entity is selected at the analyst's as-of/knowledge cutoff.

The pure reconciliation function deduplicates identical provider events and throws on event-ID reuse with contradictory content. It never silently resolves ambiguity or creates fake receipts.

A source displays FRESH / STALE / ERROR / UNKNOWN using an injected clock and known last-success/last-error timestamps. A stale or failed source does **not** justify a numeric zero in a borrowing-base calculation.

## Explicit limits
The current implementation is a pure contract plus deterministic tests:
- **No** background scheduler, durable checkpoint persistence, webhook/API source connectors, imported customer data, retries, token storage or production freshness SLO.
- The next PR must add a migration-backed outbox/checkpoint, idempotent worker, dead-letter/retry strategy and operational monitoring; no real source integration until #109 access/consent controls.
- The canonical JSON comparator is not a cryptographic signature. A tamper-resistant audit would need server-side hashes, access controls, durable event storage and independent review.
- All data remains synthetic. Contract shape can change after a lender-data review.

## Alternatives rejected
- Overwrite the current row without event history: would distort replay.
- Treat backdated updates as if the analyst knew them earlier: look-ahead bias.
- Infer a successful source refresh from an empty array: conflates missing data with zero outstanding balance.

## Tests
Duplicate import, conflicting content, delayed corrections, client isolation, date validation, freshness and failed sync state.
