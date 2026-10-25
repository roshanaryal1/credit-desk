CREATE TABLE "agent_evidence_manifests" (
	"run_id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"as_of_date" date NOT NULL,
	"validator_version" text NOT NULL,
	"canonical_json" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "evidence_manifest_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_evidence_manifests" ADD CONSTRAINT "agent_evidence_manifests_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_evidence_manifests" ADD CONSTRAINT "agent_evidence_manifests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_evidence_client_idx" ON "agent_evidence_manifests" USING btree ("client_id");
--> statement-breakpoint
CREATE TRIGGER agent_evidence_manifests_append_only
BEFORE UPDATE OR DELETE ON agent_evidence_manifests
FOR EACH ROW EXECUTE FUNCTION reject_mutation();
