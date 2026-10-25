import { z } from "zod";

// The agent's structured output (SPEC 8). Parsed from model text; the
// citation validator then checks every claim against the evidence.

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export const ClaimSchema = z.object({
  text: z.string().min(1).max(400),
  evidence_ids: z.array(z.string().min(1)).min(1),
});

export const AgentOutputSchema = z.object({
  summary: z
    .string()
    .min(1)
    .refine((s) => words(s) <= 60, "summary must be 60 words or fewer"),
  risk_level: z.enum(["low", "medium", "high"]),
  recommendation: z.enum(["APPROVE", "HOLD", "REJECT", "REQUEST_INFO"]),
  questions_for_client: z.array(z.string().min(1).max(1000)).max(5),
  claims: z.array(ClaimSchema).min(1).max(8),
  cited_evidence_ids: z.array(z.string().min(1)).min(1),
});

export type AgentOutput = z.infer<typeof AgentOutputSchema>;
