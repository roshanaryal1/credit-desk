# ADR 0018: bind decisions to one complete reviewed state

Status: proposed. Issues #182 and #185.

The former review version covered finding IDs/severity and explanation/decision
IDs. A changed invoice, finding detail or source record could keep that hash
unchanged. The panel and decision snapshot also re-read sources independently,
allowing a mixed financial state to be frozen.

A shared loader now constructs one canonical bundle of the panel records,
complete dated check context/configuration, full findings, scoped raw evidence,
validated original agent capture and prior decision history. The panel is
rendered from that bundle, and its SHA-256 is the form's review version.

Panel and save transactions use PostgreSQL serializable isolation. Saving
compares the submitted digest and freezes the same in-memory bundle without
further source reads. Database serialization/deadlock conflicts retry the whole
transaction at most three times; decision-key unique races also retry so the
winner is re-read. Exhaustion fails closed. Existing chain locking remains,
but isolation retries are essential: a transaction's MVCC snapshot can precede
its wait for that lock. An overlapping source update may serialize after an
accepted coherent state; acceptance does not promise every overlap aborts.

Snapshot schema 4 adds the full reviewed bundle and its digest while retaining
existing replay fields. Old snapshot text, hashes and IDs remain immutable.
New decision IDs use the full submission UUID; exact retries of historical
short IDs still return those original IDs.

Raw evidence is client-checked before formatting or freezing. Missing,
ambiguous or foreign evidence and foreign receipt allocations fail closed.
Captured agent facts remain distinct from current check evidence. This does
not supply authenticated identity, provider authenticity or lending authority.

Trade-offs: complete source binding adds reads and increases new snapshot size.
This favors reproducible review over a narrower, incomplete cache key. No SQL
schema migration, new service or dependency is needed. The separate PostgreSQL
concurrency verifier uses only the explicitly configured isolated audit DB and
real independent connections; normal fixture tests remain network-free.

References read for the isolation/API behavior:

- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- [Drizzle transactions](https://orm.drizzle.team/docs/transactions)
