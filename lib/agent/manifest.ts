import { eq } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { canonicalJson, sha256 } from "@/lib/trust/canonical";

import { EvidenceRegistry, type EvidenceRecord } from "./evidence";
import { validateOutput } from "./validator";

export const EVIDENCE_VALIDATOR_VERSION = "captured-evidence-v1";

export interface CapturedToolResponse {
  sequence: number;
  tool: string;
  response: unknown;
}

export interface CapturedRunEvidence {
  runId: string;
  clientId: string;
  asOf: string;
  validatorVersion: typeof EVIDENCE_VALIDATOR_VERSION;
  toolResponses: CapturedToolResponse[];
  records: EvidenceRecord[];
}

/** Canonical manifest of exactly what read-only tools returned. */
export function buildRunEvidenceManifest(input: {
  runId: string;
  clientId: string;
  asOf: string;
  toolResponses: CapturedToolResponse[];
  records: EvidenceRecord[];
}) {
  const registry = new EvidenceRegistry(input.clientId);
  for (const record of input.records) registry.add(record);
  const body: CapturedRunEvidence = {
    runId: input.runId,
    clientId: input.clientId,
    asOf: input.asOf,
    validatorVersion: EVIDENCE_VALIDATOR_VERSION,
    // Preserve original tool-call order, including limited/error responses;
    // don't capture generated raw arguments, headers or provider credentials.
    toolResponses: input.toolResponses,
    records: [...input.records].sort((a, b) => a.id.localeCompare(b.id)),
  };
  const canonicalText = canonicalJson(body);
  return { body, canonicalText, digest: sha256(canonicalText) };
}

export type StoredManifestValidation = "PASSED" | "FAILED" | "LEGACY";

/**
 * NEW runs must have an original manifest. Missing/tampered manifests fail
 * closed and must never reconstruct or silently substitute modern source rows.
 * Pre-upgrade runs retain the explicitly labelled legacy reconstruction path.
 */
export async function verifyCapturedRunEvidence(
  db: Pick<Db, "select">,
  stored: {
    run: typeof t.agentRuns.$inferSelect;
    explanation: typeof t.explanations.$inferSelect;
  },
): Promise<StoredManifestValidation> {
  const { run, explanation } = stored;
  if (run.status !== "PASSED" || explanation.validationStatus !== "PASSED") {
    return "FAILED";
  }
  const [saved] = await db
    .select()
    .from(t.agentEvidenceManifests)
    .where(eq(t.agentEvidenceManifests.runId, run.id))
    .limit(1);
  if (!saved) return run.evidenceManifestRequired ? "FAILED" : "LEGACY";
  try {
    if (
      saved.validatorVersion !== EVIDENCE_VALIDATOR_VERSION ||
      sha256(saved.canonicalJson) !== saved.sha256
    ) return "FAILED";
    const payload = JSON.parse(saved.canonicalJson) as CapturedRunEvidence;
    if (
      canonicalJson(payload) !== saved.canonicalJson ||
      payload.runId !== run.id ||
      payload.clientId !== saved.clientId ||
      payload.asOf !== saved.asOfDate ||
      payload.asOf !== run.asOfDate ||
      payload.validatorVersion !== saved.validatorVersion ||
      !Array.isArray(payload.records) ||
      !Array.isArray(payload.toolResponses)
    ) return "FAILED";
    const registry = new EvidenceRegistry(payload.clientId);
    const seen = new Set<string>();
    for (const record of payload.records) {
      if (
        !record || typeof record.id !== "string" ||
        typeof record.clientId !== "string" ||
        seen.has(record.id)
      ) return "FAILED";
      registry.add(record);
      seen.add(record.id);
    }
    // Verify the capture is a complete ordered transcript; it is not proof
    // that model reasoning was correct. Invalid transcripts fail closed.
    if (payload.toolResponses.some((entry, index) =>
      entry.sequence !== index + 1 ||
      !/^[A-Z_]+$|^get_[a-z_]+$/.test(entry.tool),
    )) return "FAILED";
    const raw = JSON.stringify({
      summary: explanation.summary,
      risk_level: explanation.riskLevel.toLowerCase(),
      recommendation: explanation.recommendation,
      questions_for_client: explanation.questionsForClient,
      claims: explanation.claims.map((claim) => ({
        text: claim.text,
        evidence_ids: claim.evidenceIds,
      })),
      cited_evidence_ids: explanation.citedEvidenceIds,
    });
    return validateOutput(raw, registry).ok ? "PASSED" : "FAILED";
  } catch {
    return "FAILED";
  }
}
