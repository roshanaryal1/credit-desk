CREATE TABLE "ingestion_events" (
  "id" text PRIMARY KEY NOT NULL,
  "source_kind" text NOT NULL,
  "connection_id" text NOT NULL,
  "client_id" text NOT NULL REFERENCES "clients"("id"),
  "event_id" text NOT NULL,
  "entity_id" text NOT NULL,
  "effective_date" date NOT NULL,
  "observed_at" timestamptz NOT NULL,
  "payload_json" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_event_identity_uq" ON "ingestion_events" ("source_kind", "connection_id", "client_id", "event_id");
--> statement-breakpoint
CREATE INDEX "ingestion_client_asof_idx" ON "ingestion_events" ("client_id", "effective_date", "observed_at");
--> statement-breakpoint
CREATE TRIGGER ingestion_events_append_only BEFORE UPDATE OR DELETE ON ingestion_events FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TABLE "ingestion_checkpoints" (
  "source_kind" text NOT NULL,
  "connection_id" text NOT NULL,
  "client_id" text NOT NULL REFERENCES "clients"("id"),
  "cursor" text,
  "last_success_at" timestamptz,
  "last_failure_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ingestion_checkpoints_pk" PRIMARY KEY ("source_kind", "connection_id", "client_id")
);
