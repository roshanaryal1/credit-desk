# ADR-0009: Independent maker-checker case workflow

Status: **Proposed; pure domain implementation only**  
Issue: #105; security #109, queue #113.

## Decision proposed

A credit exception is a case with a single owner and an explicitly versioned state machine. A verified analyst (maker) investigates and submits a proposal. A different **verified** checker accepts, holds, rejects or returns the proposal. A manager assigns/reopens/closes cases. Every transition records the actor, previous/new state, reason, incremented version and UTC instant.

Even when an actor carries both ANALYST and CHECKER roles, self-check is prohibited. Permissions are client-scoped. Approval means the *case decision*, not a funding transfer or a disbursement instruction.

## Transactional implementation requirements (not delivered by this PR)

- Identity must come from a trusted MFA-capable OIDC session (#109), never from caller-supplied display names.
- The API authorizes tenant, role and object membership before invoking this pure transition function; decisions never use browser-provided roles.
- Persist case row, versioned immutable event, any associated decision snapshot and audit record in **one serializable or compare-and-swap transaction**.
- The database update MUST check `version = expectedVersion` and reject concurrent stale approval, even if both requests passed in-memory validation.
- Reassignment, reviewer vacation, override and incident SLA rules require separate policies and UI. A maker/checker identity must not be reused across genuine human users.
- Workflow states have no linkage to a payment rail in this phase.

## Testing and release

Pure tests verify state transitions, audit metadata, role checks, client isolation, separation of duties, reasons, stale versions and reopening. No migration, API, real identity integration or UI exists in this change. Those remain blocked by the G10 and G06 follow-on work and must be tested transactionally before operational release.
