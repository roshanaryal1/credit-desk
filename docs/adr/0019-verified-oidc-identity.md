# ADR-0019: Verified identity through a provider-neutral OIDC relying party

Status: accepted (product owner chose generic OIDC on 2026-10-27). Issue #109.

## Context

The synthetic deployment uses a shared password and self-selected demo perspectives. ADR-0012 defined a deny-by-default access policy, but nothing constructed a verified identity. Real lending use needs individual accounts, MFA, client scoping, revocation and an administrator.

## Decision

- `AUTH_MODE=oidc` turns on an OpenID Connect relying party (authorization code flow with PKCE, state and nonce) using `openid-client`. The default remains `demo`, so the synthetic deployment is unchanged.
- Users are provisioned by an administrator (or `scripts/identity-bootstrap.ts` for the first one). There is no self-registration. The first sign-in binds the issuer and subject by verified email; later sign-ins match on issuer and subject only. Concurrent conflicting binds fail.
- MFA is required at sign-in. It is proven only by an explicit `mfa` method (configurable), an approved `acr`, or a knowledge factor plus a possession or inherence factor in `amr`. A single method is never enough.
- Sessions are random tokens in an `HttpOnly` cookie. The database stores only a SHA-256 hash, an 8-hour absolute expiry and a revocation timestamp. Every request resolves the session in `proxy.ts`, inside one read-only snapshot and bound to the configured tenant and issuer. Sign-out, administrator revocation and disabling a user therefore take effect on the next request.
- Roles reuse each workspace perspective's reviewed route scope: ANALYST, CHECKER, AUDITOR, and RISK_MANAGER (employer scope). ADMIN only reaches `/admin/users`. `/audit` follows `AUDIT_READ`, so it is limited to AUDITOR and RISK_MANAGER.
- Client grants: client-, batch- and decision-scoped paths return 404 without a grant. Server actions re-check the grant for the record they change. Portfolio-wide pages and exports are served only to users granted every client, because their read models are not yet filtered per grant (follow-up). Partially granted users get a "Your clients" navigation.
- Administrators manage users, roles, grants, enable/disable and "sign out everywhere". Every change is audited with before and after values. Administrators cannot remove their own ADMIN role or disable themselves.
- A deployment serves one tenant (`CREDIT_DESK_TENANT_ID`). Reseeding portfolio data keeps identity tables and restores grants for surviving clients.

## Consequences

- Maker-checker (#105) can now be built on verified, distinct identities.
- Each request adds a session lookup. That is acceptable at pilot scale; a short-lived signed cache can be added if latency matters.
- Going live needs an IdP client registration (issuer, client ID and secret, redirect URI), MFA policy at the IdP, and an HTTPS redirect URI. Loopback HTTP redirects are allowed for local testing only (RFC 8252).
- Per-grant filtering of portfolio read models, SCIM provisioning and step-up re-authentication are follow-ups.
