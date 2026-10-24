CREATE TABLE "credit_cases" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "client_id" text NOT NULL REFERENCES "clients"("id"),
  "subject_type" "subject_type" NOT NULL,
  "subject_id" text NOT NULL,
  "priority" "severity" NOT NULL,
  "due_date" date,
  "state" text NOT NULL,
  "version" integer NOT NULL DEFAULT 0,
  "owner_id" text,
  "maker_id" text,
  "checker_id" text,
  "decision_reason" text,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "credit_case_version_valid" CHECK ("version" >= 0),
  CONSTRAINT "credit_case_state_valid" CHECK ("state" IN ('NEW','ASSIGNED','IN_REVIEW','CHECKER_REVIEW','RETURNED','APPROVED','HELD','REJECTED','CLOSED')),
  CONSTRAINT "credit_case_separation" CHECK ("checker_id" IS NULL OR "maker_id" IS NULL OR "checker_id" <> "maker_id")
);
--> statement-breakpoint
CREATE INDEX "credit_cases_client_state_idx" ON "credit_cases" ("client_id", "state");
--> statement-breakpoint
CREATE INDEX "credit_cases_tenant_client_idx" ON "credit_cases" ("tenant_id", "client_id");
--> statement-breakpoint
CREATE TABLE "credit_case_events" (
  "id" text PRIMARY KEY NOT NULL,
  "case_id" text NOT NULL REFERENCES "credit_cases"("id"),
  "from_state" text,
  "to_state" text NOT NULL,
  "version" integer NOT NULL,
  "actor_id" text NOT NULL,
  "action" text NOT NULL,
  "reason" text,
  "occurred_at" timestamptz NOT NULL,
  CONSTRAINT "credit_case_event_version_valid" CHECK ("version" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "credit_case_event_version_uq" ON "credit_case_events" ("case_id", "version");
--> statement-breakpoint
CREATE INDEX "credit_case_event_history_idx" ON "credit_case_events" ("case_id", "occurred_at");
--> statement-breakpoint
CREATE TRIGGER credit_case_events_append_only BEFORE UPDATE OR DELETE ON credit_case_events FOR EACH ROW EXECUTE FUNCTION reject_mutation();
