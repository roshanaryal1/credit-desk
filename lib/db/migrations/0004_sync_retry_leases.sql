CREATE TABLE "ingestion_sync_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "source_kind" text NOT NULL,
  "connection_id" text NOT NULL,
  "client_id" text NOT NULL REFERENCES "clients"("id"),
  "state" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL,
  "next_attempt_at" timestamptz NOT NULL,
  "lease_token" text,
  "lease_until" timestamptz,
  "last_error_code" text,
  "last_error_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sync_attempts_valid" CHECK ("attempts" >= 0 AND "max_attempts" > 0 AND "attempts" <= "max_attempts"),
  CONSTRAINT "sync_state_valid" CHECK ("state" IN ('PENDING', 'LEASED', 'SUCCEEDED', 'DEAD')),
  CONSTRAINT "sync_lease_pair" CHECK (("lease_token" IS NULL) = ("lease_until" IS NULL)),
  CONSTRAINT "sync_leased_has_token" CHECK (("state" = 'LEASED') = ("lease_token" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_sync_source_uq" ON "ingestion_sync_jobs" ("source_kind", "connection_id", "client_id");
--> statement-breakpoint
CREATE INDEX "ingestion_sync_due_idx" ON "ingestion_sync_jobs" ("state", "next_attempt_at");
