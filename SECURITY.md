# Security policy

## Scope

This is a prototype running on synthetic data only. It must never hold real
customer, debtor or bank data.

## Secrets

- Secrets live only in environment variables (local `.env`, Vercel project
  settings, GitHub Actions secrets). `.env*` is git-ignored; `.env.example`
  documents every variable with no real values.
- The LLM API key is read only in server code. It must never appear in client
  bundles, logs, test fixtures or issue text.
- If a secret is committed, rotate it first, then remove it from history.

## Prototype controls

- Shared-password gate (`DEMO_PASSWORD`) with a signed, expiring, httpOnly
  session cookie, login throttling and Origin checks on mutations.
- Agent re-runs limited per session, per IP and by a global daily cap.
- Append-only audit, decision snapshot and agent run tables.
- Every LLM output is validated with Zod and the citation validator before use.
- The agent is read-only and never approves or funds anything.

## Reporting a vulnerability

Open a private security advisory on this repository (Security tab, "Report a
vulnerability"). Do not file a public issue.
