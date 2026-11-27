CREATE TRIGGER decisions_append_only BEFORE UPDATE OR DELETE ON public.decisions
FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();
--> statement-breakpoint
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON public.agent_runs
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_mutation();
--> statement-breakpoint
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON public.agent_evidence_manifests
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_mutation();
--> statement-breakpoint
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON public.explanations
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_mutation();
--> statement-breakpoint
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON public.decisions
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_mutation();
--> statement-breakpoint
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON public.decision_snapshots
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_mutation();
--> statement-breakpoint
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON public.audit_events
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_mutation();
--> statement-breakpoint
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON public.incident_events
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_mutation();
--> statement-breakpoint
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON public.ingestion_events
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_mutation();
--> statement-breakpoint
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON public.credit_case_events
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_mutation();
