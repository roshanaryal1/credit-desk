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

function validDay(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

function responseRecords(tool: string, response: unknown): EvidenceRecord[] {
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("Invalid tool response");
    return value as Record<string, unknown>;
  };
  const record = (value: unknown, type: string): EvidenceRecord => {
    const r = object(value);
    if (
      r.type !== type ||
      typeof r.id !== "string" ||
      !r.id ||
      typeof r.clientId !== "string"
    )
      throw Error("Invalid evidence record");
    return r as EvidenceRecord;
  };
  const list = (value: unknown, type: string) => {
    if (!Array.isArray(value)) throw Error("Invalid evidence list");
    return value.map((r) => record(r, type));
  };
  const allowed = new Set([
    "get_invoice",
    "get_ledger_entry",
    "get_bank_transactions",
    "get_debtor_history",
    "get_findings",
    "get_funding",
    "get_incident",
    "UNSUPPORTED",
  ]);
  if (!allowed.has(tool)) throw Error("Unsupported captured tool");
  if (tool === "get_findings" && Array.isArray(response))
    return list(response, "finding");
  const r = object(response);
  if (typeof r.error === "string") {
    if (
      tool === "UNSUPPORTED" &&
      canonicalJson(r) !== canonicalJson({ error: "unsupported tool" })
    )
      throw Error("Invalid unsupported response");
    return [];
  }
  switch (tool) {
    case "get_invoice":
      return [record(r, "invoice")];
    case "get_incident":
      return [record(r, "incident")];
    case "get_ledger_entry":
      if (r.found === false) return [];
      if (r.found !== true) throw Error("Invalid ledger response");
      return [
        record(r.entry, "ledger_entry"),
        ...list(r.creditNotes, "credit_note"),
      ];
    case "get_bank_transactions":
      return list(r.transactions, "bank_transaction");
    case "get_debtor_history":
      return [
        record(r.debtor, "debtor"),
        ...list(r.paymentsLast12Months, "debtor_payment"),
      ];
    case "get_funding":
      if (r.funded === false) return [];
      if (r.funded !== true) throw Error("Invalid funding response");
      return [
        record(r.funding, "funding"),
        ...list(r.adjustments, "funding_adjustment"),
      ];
    default:
      throw Error("Invalid captured response");
  }
}

function verifyTranscript(payload: CapturedRunEvidence) {
  const returned = new Map<string, EvidenceRecord>();
  for (const [index, entry] of payload.toolResponses.entries()) {
    if (!entry || entry.sequence !== index + 1)
      throw Error("Invalid capture order");
    for (const record of responseRecords(entry.tool, entry.response)) {
      if (record.clientId !== payload.clientId)
        throw Error("Cross-client response");
      const dateFields: Record<string, string> = {
        invoice: "submittedDate",
        ledger_entry: "recordedDate",
        credit_note: "date",
        bank_transaction: "date",
        debtor_payment: "paidDate",
        debtor: "firstSeenDate",
        funding: "fundedDate",
        funding_adjustment: "date",
        incident: "firstDetectedDate",
      };
      const dateField = dateFields[String(record.type)];
      const date = dateField ? record[dateField] : undefined;
      if (dateField && (!validDay(date) || date > payload.asOf))
        throw Error("Evidence outside capture date");
      returned.set(record.id, record);
    }
  }
  if (returned.size !== payload.records.length)
    throw Error("Incomplete capture");
  for (const record of payload.records) {
    if (canonicalJson(returned.get(record.id)) !== canonicalJson(record))
      throw Error("Orphan or substituted evidence");
  }
}

export type StoredManifestValidation = "PASSED" | "FAILED" | "LEGACY";

/**
 * NEW runs must have an original manifest. Missing/tampered manifests fail
 * closed and must never reconstruct or silently substitute modern source rows.
 * Pre-upgrade runs retain the explicitly labelled legacy reconstruction path.
 */
export async function readCapturedRunEvidence(
  db: Pick<Db, "select">,
  stored: {
    run: typeof t.agentRuns.$inferSelect;
    explanation: typeof t.explanations.$inferSelect;
  },
): Promise<
  | {
      status: "PASSED";
      saved: typeof t.agentEvidenceManifests.$inferSelect;
      body: CapturedRunEvidence;
    }
  | { status: "FAILED" | "LEGACY" }
> {
  const { run, explanation } = stored;
  if (run.status !== "PASSED" || explanation.validationStatus !== "PASSED") {
    return { status: "FAILED" };
  }
  try {
    const [saved] = await db
      .select()
      .from(t.agentEvidenceManifests)
      .where(eq(t.agentEvidenceManifests.runId, run.id))
      .limit(1);
    if (!saved)
      return { status: run.evidenceManifestRequired ? "FAILED" : "LEGACY" };
    if (
      saved.validatorVersion !== EVIDENCE_VALIDATOR_VERSION ||
      sha256(saved.canonicalJson) !== saved.sha256
    )
      return { status: "FAILED" };
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
    )
      return { status: "FAILED" };
    if (!validDay(payload.asOf) || explanation.agentRunId !== run.id)
      return { status: "FAILED" };
    const [subject] =
      run.subjectType === "INVOICE"
        ? await db
            .select({
              clientId: t.invoices.clientId,
              cutoff: t.batches.submittedDate,
            })
            .from(t.invoices)
            .innerJoin(t.batches, eq(t.invoices.batchId, t.batches.id))
            .where(eq(t.invoices.id, run.subjectId))
            .limit(1)
        : run.subjectType === "INCIDENT"
          ? await db
              .select({
                clientId: t.incidents.clientId,
                cutoff: t.incidents.firstDetectedDate,
              })
              .from(t.incidents)
              .where(eq(t.incidents.id, run.subjectId))
              .limit(1)
          : [];
    if (
      !subject ||
      subject.clientId !== payload.clientId ||
      !validDay(subject.cutoff) ||
      (run.subjectType === "INVOICE"
        ? payload.asOf !== subject.cutoff
        : payload.asOf < subject.cutoff)
    )
      return { status: "FAILED" };
    const registry = new EvidenceRegistry(payload.clientId);
    const seen = new Set<string>();
    for (const record of payload.records) {
      if (
        !record ||
        typeof record.id !== "string" ||
        typeof record.clientId !== "string" ||
        seen.has(record.id)
      )
        return { status: "FAILED" };
      registry.add(record);
      seen.add(record.id);
    }
    verifyTranscript(payload);
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
    return validateOutput(raw, registry).ok
      ? { status: "PASSED", saved, body: payload }
      : { status: "FAILED" };
  } catch {
    return { status: "FAILED" };
  }
}

/** Status-only compatibility wrapper. Use the verified body for display or freezing. */
export async function verifyCapturedRunEvidence(
  db: Pick<Db, "select">,
  stored: {
    run: typeof t.agentRuns.$inferSelect;
    explanation: typeof t.explanations.$inferSelect;
  },
): Promise<StoredManifestValidation> {
  return (await readCapturedRunEvidence(db, stored)).status;
}
