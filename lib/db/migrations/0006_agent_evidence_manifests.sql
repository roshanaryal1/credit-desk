-- Future runs must contain an immutable original-tool evidence manifest.
-- Existing runs remain legacy records and can use the explicit legacy fallback.
ALTER TABLE "agent_runs" ADD COLUMN "evidence_manifest_required" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE "agent_evidence_manifests" (
  "run_id" text PRIMARY KEY NOT NULL REFERENCES "agent_runs"("id"),
  "client_id" text NOT NULL REFERENCES "clients"("id"),
  "as_of_date" date NOT NULL,
  "validator_version" text NOT NULL,
  "canonical_json" text NOT NULL,
  "sha256" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "agent_evidence_client_idx" ON "agent_evidence_manifests" ("client_id");
--> statement-breakpoint
CREATE TRIGGER agent_evidence_manifests_append_only
BEFORE UPDATE OR DELETE ON agent_evidence_manifests
FOR EACH ROW EXECUTE FUNCTION reject_mutation();
