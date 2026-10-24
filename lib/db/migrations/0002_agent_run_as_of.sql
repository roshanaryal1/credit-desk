ALTER TABLE "agent_runs" ADD COLUMN "as_of_date" date;
--> statement-breakpoint
-- Backfill existing runs (agent_runs is append-only, so the trigger is lifted for this one statement).
ALTER TABLE "agent_runs" DISABLE TRIGGER agent_runs_append_only;
--> statement-breakpoint
UPDATE "agent_runs" r SET "as_of_date" = b."submitted_date" FROM "invoices" i JOIN "batches" b ON b."id" = i."batch_id" WHERE r."subject_type" = 'INVOICE' AND r."subject_id" = i."id";
--> statement-breakpoint
UPDATE "agent_runs" r SET "as_of_date" = inc."last_detected_date" FROM "incidents" inc WHERE r."subject_type" = 'INCIDENT' AND r."subject_id" = inc."id";
--> statement-breakpoint
ALTER TABLE "agent_runs" ENABLE TRIGGER agent_runs_append_only;
