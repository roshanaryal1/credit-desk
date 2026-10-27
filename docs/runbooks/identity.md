# Runbook: verified sign-in (OIDC)

Applies when `AUTH_MODE=oidc` (#109, ADR-0019).

## Configure

1. Register a confidential web client at the identity provider with the redirect URI `https://<host>/auth/callback`. Require MFA for the application, and confirm the ID token carries `amr` (or an agreed `acr`).
2. Set the server environment (never `NEXT_PUBLIC_`): `AUTH_MODE=oidc`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `CREDIT_DESK_TENANT_ID`, `SESSION_SECRET` (at least 32 characters). Optional: `OIDC_MFA_AMR` (default `mfa`) and `OIDC_MFA_ACR`.
3. Apply database migrations (`npm run db:migrate`).
4. Provision the first administrator: `npx tsx --env-file-if-exists=.env.local scripts/identity-bootstrap.ts --email admin@example.org --name "Name" --roles ADMIN`.
5. The administrator signs in and provisions other users at `/admin/users`.

## Operate

- **Remove access now:** in `/admin/users`, choose "Sign out everywhere" (keeps the account) or "Disable user" (revokes every session and blocks sign-in).
- **Sign-in errors** appear on `/login`: `mfa_required`, `not_provisioned`, `disabled`, `identity_conflict` (the account is bound to another identity; re-provision deliberately) and `expired` (the sign-in took longer than 10 minutes).
- **Rotate the client secret:** update `OIDC_CLIENT_SECRET` and redeploy. Existing sessions continue.
- **Invalidate every session:** run `update auth_sessions set revoked_at = now(), revoked_reason = 'ADMIN_REVOKE' where revoked_at is null;` through the approved database console, recorded in a change ticket.
- **Audit:** `audit_events` records `SIGN_IN`, `SESSION_REVOKED`, `USER_PROVISIONED`, `USER_ACCESS_CHANGED`, `USER_ENABLED` and `USER_DISABLED` with the acting user.

## Test locally

`scripts/mock-oidc-provider.mjs` is a test-only IdP (HTTPS with a throwaway certificate). `scripts/identity-e2e.mjs` drives the browser journeys. Never deploy the mock.
