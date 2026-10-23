CREATE TYPE "public"."adjustment_kind" AS ENUM('COLLECTION', 'DILUTION', 'WRITE_OFF');--> statement-breakpoint
CREATE TYPE "public"."batch_status" AS ENUM('PENDING', 'REVIEWED');--> statement-breakpoint
CREATE TYPE "public"."decision_value" AS ENUM('APPROVE', 'HOLD', 'REJECT');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'REOPENED');--> statement-breakpoint
CREATE TYPE "public"."ledger_status" AS ENUM('AUTHORISED', 'PAID', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."recommendation" AS ENUM('APPROVE', 'HOLD', 'REJECT', 'REQUEST_INFO');--> statement-breakpoint
CREATE TYPE "public"."review_mode" AS ENUM('SHADOW', 'ASSIST');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('PASSED', 'FAILED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."subject_type" AS ENUM('INVOICE', 'INCIDENT');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_type" "subject_type" NOT NULL,
	"subject_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"config_version" text NOT NULL,
	"code_sha" text NOT NULL,
	"attempts" integer NOT NULL,
	"status" "run_status" NOT NULL,
	"tokens_in" integer NOT NULL,
	"tokens_out" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"counterparty_name" text NOT NULL,
	"reference" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"submitted_date" date NOT NULL,
	"status" "batch_status" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"industry" text NOT NULL,
	"advance_rate_bps" integer DEFAULT 8000 NOT NULL,
	"facility_limit_cents" integer NOT NULL,
	"payment_terms_days" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"ledger_entry_id" text NOT NULL,
	"date" date NOT NULL,
	"amount_cents" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debtor_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"debtor_id" text NOT NULL,
	"ledger_entry_id" text,
	"invoice_number" text NOT NULL,
	"issue_date" date NOT NULL,
	"paid_date" date NOT NULL,
	"amount_cents" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debtors" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"nzbn" text NOT NULL,
	"first_seen_date" date NOT NULL,
	"credit_band" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_snapshots" (
	"decision_id" text PRIMARY KEY NOT NULL,
	"canonical_json" text NOT NULL,
	"sha256" text NOT NULL,
	"prev_sha256" text,
	"schema_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"decision" "decision_value" NOT NULL,
	"reason" text NOT NULL,
	"analyst_session_id" text NOT NULL,
	"analyst_display_name" text NOT NULL,
	"mode" "review_mode" NOT NULL,
	"explanation_id_at_decision" text,
	"ai_content_exposed_before_decision" boolean NOT NULL,
	"review_version" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"simulated" boolean NOT NULL,
	"decided_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "explanations" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_run_id" text NOT NULL,
	"summary" text NOT NULL,
	"risk_level" "severity" NOT NULL,
	"recommendation" "recommendation" NOT NULL,
	"questions_for_client" jsonb NOT NULL,
	"claims_json" jsonb NOT NULL,
	"cited_evidence_ids" jsonb NOT NULL,
	"validation_status" "run_status" NOT NULL,
	"validation_errors" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exposures" (
	"session_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"exposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exposures_session_id_invoice_id_pk" PRIMARY KEY("session_id","invoice_id")
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"check_id" text NOT NULL,
	"severity" "severity" NOT NULL,
	"details_json" jsonb NOT NULL,
	"config_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funding_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"funding_id" text NOT NULL,
	"date" date NOT NULL,
	"kind" "adjustment_kind" NOT NULL,
	"amount_cents" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fundings" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"funded_date" date NOT NULL,
	"advance_cents" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_events" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"status" "incident_status" NOT NULL,
	"note" text,
	"actor" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_key" text NOT NULL,
	"rule_id" text NOT NULL,
	"client_id" text NOT NULL,
	"debtor_id" text,
	"funding_id" text,
	"severity" "severity" NOT NULL,
	"first_detected_date" date NOT NULL,
	"last_detected_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"client_id" text NOT NULL,
	"debtor_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"invoice_id" text PRIMARY KEY NOT NULL,
	"expected_check_ids" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"debtor_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"issue_date" date NOT NULL,
	"recorded_date" date NOT NULL,
	"supersedes_ledger_entry_id" text
);
--> statement-breakpoint
CREATE TABLE "ledger_status_events" (
	"ledger_entry_id" text NOT NULL,
	"status" "ledger_status" NOT NULL,
	"effective_date" date NOT NULL,
	CONSTRAINT "ledger_status_events_ledger_entry_id_effective_date_status_pk" PRIMARY KEY("ledger_entry_id","effective_date","status")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_events" (
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_allocations" (
	"bank_transaction_id" text NOT NULL,
	"ledger_entry_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	CONSTRAINT "receipt_allocations_bank_transaction_id_ledger_entry_id_pk" PRIMARY KEY("bank_transaction_id","ledger_entry_id")
);
--> statement-breakpoint
CREATE TABLE "watch_detections" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"incident_key" text NOT NULL,
	"as_of_date" date NOT NULL,
	"details_json" jsonb NOT NULL,
	"config_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_labels" (
	"rule_id" text NOT NULL,
	"incident_key" text NOT NULL,
	"expected_from_date" date NOT NULL,
	"expected_to_date" date NOT NULL,
	CONSTRAINT "watch_labels_rule_id_incident_key_pk" PRIMARY KEY("rule_id","incident_key")
);
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debtor_payments" ADD CONSTRAINT "debtor_payments_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debtor_payments" ADD CONSTRAINT "debtor_payments_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debtors" ADD CONSTRAINT "debtors_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_snapshots" ADD CONSTRAINT "decision_snapshots_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_explanation_id_at_decision_explanations_id_fk" FOREIGN KEY ("explanation_id_at_decision") REFERENCES "public"."explanations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explanations" ADD CONSTRAINT "explanations_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exposures" ADD CONSTRAINT "exposures_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_adjustments" ADD CONSTRAINT "funding_adjustments_funding_id_fundings_id_fk" FOREIGN KEY ("funding_id") REFERENCES "public"."fundings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundings" ADD CONSTRAINT "fundings_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_funding_id_fundings_id_fk" FOREIGN KEY ("funding_id") REFERENCES "public"."fundings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_status_events" ADD CONSTRAINT "ledger_status_events_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_bank_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_subject_idx" ON "agent_runs" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bank_client_date_idx" ON "bank_transactions" USING btree ("client_id","date");--> statement-breakpoint
CREATE INDEX "batches_client_idx" ON "batches" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "credit_notes_ledger_idx" ON "credit_notes" USING btree ("ledger_entry_id");--> statement-breakpoint
CREATE INDEX "payments_debtor_paid_idx" ON "debtor_payments" USING btree ("debtor_id","paid_date");--> statement-breakpoint
CREATE INDEX "debtors_client_idx" ON "debtors" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_idempotency_uq" ON "decisions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "decisions_invoice_idx" ON "decisions" USING btree ("invoice_id","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "explanations_run_uq" ON "explanations" USING btree ("agent_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "findings_invoice_check_version_uq" ON "findings" USING btree ("invoice_id","check_id","config_version");--> statement-breakpoint
CREATE INDEX "adjustments_funding_idx" ON "funding_adjustments" USING btree ("funding_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "fundings_invoice_uq" ON "fundings" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "incident_events_idx" ON "incident_events" USING btree ("incident_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_key_uq" ON "incidents" USING btree ("incident_key");--> statement-breakpoint
CREATE INDEX "invoices_batch_idx" ON "invoices" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "invoices_client_number_idx" ON "invoices" USING btree ("client_id","invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_debtor_idx" ON "invoices" USING btree ("debtor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_client_invoice_uq" ON "ledger_entries" USING btree ("client_id","invoice_number");--> statement-breakpoint
CREATE INDEX "ledger_debtor_idx" ON "ledger_entries" USING btree ("debtor_id");--> statement-breakpoint
CREATE INDEX "rate_limit_key_idx" ON "rate_limit_events" USING btree ("key","created_at");--> statement-breakpoint
CREATE INDEX "alloc_ledger_idx" ON "receipt_allocations" USING btree ("ledger_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "detections_rule_key_date_uq" ON "watch_detections" USING btree ("rule_id","incident_key","as_of_date");