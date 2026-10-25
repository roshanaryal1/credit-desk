# ADR 0012: immutable original agent evidence (#164)

Status: reviewed synthetic release candidate, 2026-10-26. Follow-up to
ADR-0004 and the 2026-10-25 stored-explanation review.

## Problem

Existing explanations preserve citations and immutable decision snapshots, but
read-time validation reconstructs citations using *current* source records.
A changed source record or missing historic tool response can make replay seem
more certain than the evidence originally available to the model.

## Decision

1. New agent runs store `evidence_manifest_required = true`. Historical
   rows default false (migration 0006) and remain explicitly LEGACY.
2. A manifest records the run ID, client, business date, validator version,
   ordered allowlisted read-only tool responses (no raw arguments or API
   headers), and exactly the scoped records registered as citable evidence.
3. Store canonical JSON **text** and SHA-256. An append-only PostgreSQL trigger
   blocks regular UPDATE/DELETE. Run, manifest and explanation commit in one
   database transaction: interrupted writes roll back, not leaving an
   apparently successful run without an evidence manifest.
4. New-run revalidation operates **only on the saved canonical manifest**.
   Missing, inconsistent, unparseable, tampered or cross-client manifests fail
   closed. It never falls back to current-source reconstruction. Existing
   no-manifest runs still take the previously documented dated reconstruction
   route, which is NOT exact original-tool proof.
5. Bind the manifest to the run subject, its client and valid business cutoff.
   Require ordered supported tool responses to match the captured registry
   exactly; orphan or substituted records fail closed.
6. New schema-3 decision snapshots preserve the verified original manifest and
   original cited records, separate from current decision-time check inputs.
   Invoice and Watch citations display captured facts rather than modern rows.
7. Preserve historical run status, validation outcomes and decision snapshot
   hashes. Current validator recheck is distinct from historic PASSED status.

## Limitations and security model

- The manifest demonstrates what the typed tools returned in the synthetic
  run, not the correctness of the LLM's reasoning or the authenticity of an
  accounting or bank provider.
- This hash and append-only trigger detect ordinary data manipulation.
  Database administrators with full privileges can rewrite both the data and
  stored checksum. Production requires separate write-once hash anchoring,
  access audits, retention, privacy review and restore drills.
- The tool executor only exposes scoped fictional business records and
  validated read-only operations. Unknown tool names are suppressed from
  durable transcripts; API keys, request headers, provider credentials and
  raw generated arguments are never captured.
- Old explanations and old decision snapshots are not backfilled or rewritten.
  Do not present historic reconstruction as equivalent to original tool evidence.
- Migration 0006 is additive. Verify it on a synthetic-data branch, including
  unchanged historical rows and working append-only protection, before applying
  it to the hosted demo and deploying code that requires the new table.

## Verification

- Clean and upgrade migrations, transaction rollback on manifest insertion
  failure, immutable trigger, cryptographic checksum and missing row fail-closed.
- Scripted tool call demonstrates original evidence capture and source-free
  revalidation even when current seeded invoice data changes.
- Cross-client evidence inclusion fails prior to write.
- Exact-head full CI, browser read-only smoke and independent security review
  before approval; production data retention and hash anchoring remain open.
