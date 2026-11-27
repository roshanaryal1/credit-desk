-- Apply as the table owner after migrations and CREATE ROLE credit_desk_app.
-- This is also executed by tests/db/runtime-role.test.ts.
BEGIN;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO credit_desk_app', current_database());
END;
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO credit_desk_app;

-- Reapplying this file removes obsolete direct table grants.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM credit_desk_app;

-- Portfolio source records are read by runtime queries and tools.
GRANT SELECT ON public.clients, public.debtors, public.batches, public.invoices,
  public.ledger_entries, public.ledger_status_events, public.credit_notes,
  public.bank_transactions, public.receipt_allocations, public.debtor_payments,
  public.fundings, public.funding_adjustments TO credit_desk_app;

-- Immutable histories, findings, exposures, watch detections and rate limits.
GRANT SELECT, INSERT ON public.decisions, public.decision_snapshots,
  public.audit_events, public.agent_runs, public.agent_evidence_manifests,
  public.explanations, public.exposures, public.watch_detections,
  public.incident_events, public.rate_limit_events, public.findings,
  public.credit_case_events, public.ingestion_events TO credit_desk_app;

-- Mutable incident, case, checkpoint and retry state.
GRANT SELECT, INSERT, UPDATE ON public.incidents, public.credit_cases,
  public.ingestion_checkpoints, public.ingestion_sync_jobs TO credit_desk_app;

-- Sign-in, revocation and user administration.
GRANT SELECT, INSERT, UPDATE ON public.users, public.auth_sessions TO credit_desk_app;
GRANT SELECT, INSERT, DELETE ON public.user_roles, public.user_client_grants TO credit_desk_app;

-- Current IDs are application-generated. The schema has no sequences.
COMMIT;
