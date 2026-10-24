# Deploying Credit Desk

Vercel hosts the app; Neon (through the Vercel Marketplace) holds the data.
Each step below needs an account owner, so it is run by a person.

## Fail-closed database requirement

A hosted runtime must have `DATABASE_URL` configured for persistent PostgreSQL.
Without it, the app fails closed instead of silently using temporary PGlite.
Only disposable GitHub Actions browser smoke may set both `CI=true` and
`CREDIT_DESK_CI_PGLITE=1`; Vercel must never set the exception.
A READY Vercel build is not evidence of migrated tables or functioning login.

## 1. Project and database

1. On vercel.com, import the `credit-desk` repository. Framework: Next.js.
   Node version: 24.
2. In the project, open Storage and add Neon Postgres. It sets
   `DATABASE_URL` for production. Give previews their own database branch so
   they never touch production data (SPEC 11).

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

## Read-only synthetic database preflight

Before any owner-authorised migration or seed, explicitly select the target
with a secret `DATABASE_URL` in the operator environment. Run
`npm run demo:preflight -- --target=preview` to inspect schema, migration journal
and fictional fixture counts **without writing anything**. A successful
preflight is preliminary, not a proof of live authentication or data provenance.
See [the demo readiness runbook](runbooks/demo-readiness.md) for the full gates.
Never run seed/reset against customer records or a production dataset.

## 3. Data

From a local checkout, with production `DATABASE_URL` in the shell only (not
in `.env.local`):

```bash
export DATABASE_URL="postgres://..."      # from the Neon dashboard
npm run db:migrate
npm run seed -- --target=production       # data, checks, 90 days of watch runs
npm run precompute                        # about a minute per item; see the note below
npm run simulate                          # simulated agreement history
unset DATABASE_URL
```

`seed` refuses to reset a database that holds live decisions unless `--force`
is passed.

Groq's free tier caps `openai/gpt-oss-120b` at 200,000 tokens a day, about 28
explanations. If the precompute stops with rate-limit errors, either rerun it
the next day (it resumes) or finish with `LLM_MODEL=openai/gpt-oss-20b npm run
precompute`. Each run records the model it used. Keep the production key's
daily budget free on demo day so the Re-run button works.

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
