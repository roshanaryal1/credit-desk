# Deploying Credit Desk

Vercel hosts the app; a dedicated Neon PostgreSQL database holds the synthetic
demonstration data. Deployment and database changes require the owner's
authorization. The current project uses Node 24 and Sydney compute for both
services. No domain purchase is needed for the existing owned subdomain.

## Fail-closed database requirement

A hosted runtime must have `DATABASE_URL` configured for persistent PostgreSQL.
Without it, the app fails closed instead of silently using temporary PGlite.
Only disposable GitHub Actions browser smoke may set both `CI=true` and
`CREDIT_DESK_CI_PGLITE=1`; Vercel must never set the exception.
A READY Vercel build is not evidence of migrated tables or functioning login.

## 1. Project and database

1. On vercel.com, import the `credit-desk` repository. Framework: Next.js.
   Node version: 24.
2. Connect the dedicated Neon database with an encrypted production
   `DATABASE_URL` for the app role below. A Marketplace integration is optional.
   Give previews their own database branch so they never touch production data
   (SPEC 11).

### Database owner and runtime role

Run `npm run db:migrate` and authorized `npm run seed` jobs with the role that
owns the public tables. Supply its `DATABASE_URL` only to the operator job.
The seed temporarily disables each named truncate trigger in the same
transaction as the reset. PostgreSQL requires ownership to alter these
triggers and rolls back the changes if the transaction fails.

After migration, use psql 15 or later to connect to the database as its owner.
Create a fresh login with SQL so it receives ordinary PostgreSQL privileges.
Neon grants elevated `neon_superuser` membership to roles created in its
Console by default. Keep the runtime role outside the owner and admin roles.
[Neon role management](https://neon.com/docs/manage/roles)

Supply a generated password in the operator environment variable
`CREDIT_DESK_APP_PASSWORD`. Run psql from the repository root.

```sql
\set ON_ERROR_STOP on
\getenv app_password CREDIT_DESK_APP_PASSWORD
CREATE ROLE credit_desk_app LOGIN PASSWORD :'app_password';
\i scripts/db/runtime-grants.sql
```

The versioned [runtime grants](../scripts/db/runtime-grants.sql) are exercised
by [the runtime role test](../tests/db/runtime-role.test.ts) using application
write functions under `SET ROLE credit_desk_app`. Reapply the file after each
migration and review it when adding a write path. It includes the case,
findings and ingestion domain primitives, which currently have script or
test callers. The current schema uses application-generated IDs and requires
no sequence grants.

Set Vercel's `DATABASE_URL` to the connection string for `credit_desk_app`
on each deployment's branch and redeploy. For an existing owner-connected
deployment, remove the owner credential from the runtime environment, rotate
the owner's password in Neon and update the operator secret. Reserve
`TRUNCATE`, trigger management and schema changes for the owner. Review grants
when a migration adds a table or an application feature adds a write path.

## 2. Environment variables (Production)

| Name | Value |
| --- | --- |
| `LLM_PROVIDER` | `groq` |
| `LLM_BASE_URL` | `https://api.groq.com/openai/v1` |
| `LLM_API_KEY` | Groq key (console.groq.com). Never add a payment method to that account. |
| `LLM_MODEL` | `openai/gpt-oss-120b` |
| `DEMO_PASSWORD` | A long random password to share with reviewers |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `CRON_SECRET` | Optional, `openssl rand -hex 32` |

Without `DEMO_PASSWORD` and `SESSION_SECRET` the production app returns 503
rather than serving unprotected.

## Optional one-click visitor demo

For a **separate fictional-only** instance, verify the connected database has no live borrower, lender or bank records, run the non-destructive demo preflight, then (and only then) set both `PUBLIC_DEMO_ENABLED=1` and `CREDIT_DESK_DATA_CLASSIFICATION=SYNTHETIC`. The latter is an operator declaration, not a technical guarantee. `DEMO_PASSWORD` and `SESSION_SECRET` must also be configured, but neither is displayed to public visitors. The five one-click demo accounts are signed, short-lived (60 minutes) and read-only. They do not require real passwords; their displayed `.example` email addresses are labels only.

**Never enable on a mixed/live dataset.** No new demo code should be deployed to the public custom domain until hosted migrations/fictional seed and accessibility/browser/security acceptance pass. Disable the switches to prevent new public sessions; rotate `SESSION_SECRET` to invalidate existing sessions. The reviewer-password path remains available for privileged synthetic demonstrations.

## Read-only synthetic database preflight

Before any owner-authorised migration or seed, explicitly select the target
with a secret `DATABASE_URL` in the operator environment. Run
`npm run demo:preflight -- --target=preview` to inspect schema, migration journal
and fictional fixture counts **without writing anything**. A successful
preflight is preliminary, not a proof of live authentication or data provenance.
See [the demo readiness runbook](runbooks/demo-readiness.md) for the full gates.
Never run seed/reset against customer records or a production dataset.

## 3. Data

The existing hosted synthetic dataset was imported with its stored explanations
and decision history, then checked for row equality. Do not reseed it during a
routine deployment. Run `npm run demo:preflight -- --target=production` with the
explicit target connection provided through the approved secret mechanism.

The commands below are for a **new, empty, fictional-only database** after
explicit migration and seed authorization. `seed` replaces data. Keep the
target connection out of `.env.local` and command history:

```bash
npm run db:migrate
npm run seed -- --target=production       # data, checks, 90 days of watch runs
npm run precompute                        # stored explanations; see rate-limit note
npm run simulate                          # simulated agreement history
```

`seed` refuses to reset a database that holds live decisions unless `--force`
is passed.

Provider rate limits depend on the account. Precompute resumes stored work;
check the provider's actual response and account limits before retrying. Each
run records its model. Deploying existing explanations does not require new
LLM calls. Public one-click sessions cannot invoke the agent.

## 4. Deploy and smoke test

Canonical production URL: **https://creditdesk.roshanaryal.com**.
The hostname is attached to the `credit-desk` Vercel project and configured via
an external CNAME. The legacy `credit-desk-inky.vercel.app` hostname redirects
permanently (HTTP 308) to the canonical domain using a host-scoped, project-level
CDN routing rule. Preserve that rule if recreating or transferring the project.
This is independent of preview deployment URLs, and it does not make the
synthetic prototype a production lending application.

1. Deploy from the Vercel dashboard (or push to `main`).
2. In a private window on a laptop and on a phone: sign in, open a pending
   batch, decide on a flagged invoice in shadow mode, then open its replay and
   confirm "Checksum matches".
3. Check the Trust Panel shows the live decision in the live cohort.

## Optional: daily watch run

Add a cron to `vercel.json` (or `vercel.ts`) calling `/api/watch/run` daily.
Vercel sends `Authorization: Bearer $CRON_SECRET`, which the route checks.
