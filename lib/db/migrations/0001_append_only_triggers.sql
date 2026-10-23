-- Append-only tables (SPEC 4.2, ADR 0004): reject UPDATE and DELETE.
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER agent_runs_append_only BEFORE UPDATE OR DELETE ON agent_runs FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER explanations_append_only BEFORE UPDATE OR DELETE ON explanations FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER decision_snapshots_append_only BEFORE UPDATE OR DELETE ON decision_snapshots FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER incident_events_append_only BEFORE UPDATE OR DELETE ON incident_events FOR EACH ROW EXECUTE FUNCTION reject_mutation();
