# ADR-0012 — Scoped verified identity and policy enforcement (proposed)

Issue #109. This PR adds a **pure deny-by-default access policy**, not a complete identity system.

**Trust boundary:** only a server-side, cryptographically verified OIDC session parser may construct the IdentityContext. The existing shared-password demo session is self-declared, never qualifies as verified, and must not be promoted into real privileged permissions.

Each request is constrained by tenant, explicit client grants, current token expiry, purpose-specific roles and MFA for checker/policy/audit/connection actions. The policy always denies execution of funding until the separate drawdown security approval #107. Even admins cannot bypass tenant/client boundaries. No role claims may be accepted from browser input.

Future work: choose an OIDC provider; token audience/issuer/signature verification; session rotation/revocation; MFA authentication methods; request middleware and DB row scoping; verified maker/checker separation; rate limiting, audit and tracing; threat model and negative integration tests.

This policy cannot be called production-ready until it is enforced on every API and query and reviewed independently. Synthetic prototype must remain labelled accordingly.
