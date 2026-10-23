import { and, desc, eq } from "drizzle-orm";

import { CONFIG_VERSION } from "@/lib/checks/config";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

import { canonicalJson, sha256 } from "./canonical";

// What an analyst is looking at when they decide. The review version is a
// hash of it; a decision submitted against an older version is rejected
// (SPEC 9.3, X12).

export async function latestExplanation(
  db: Pick<Db, "select">,
  invoiceId: string,
) {
  const [row] = await db
    .select({ explanation: t.explanations, run: t.agentRuns })
    .from(t.explanations)
    .innerJoin(t.agentRuns, eq(t.explanations.agentRunId, t.agentRuns.id))
    .where(
      and(
        eq(t.agentRuns.subjectType, "INVOICE"),
        eq(t.agentRuns.subjectId, invoiceId),
      ),
    )
    .orderBy(desc(t.agentRuns.createdAt), desc(t.agentRuns.id))
    .limit(1);
  return row ?? null;
}

export async function reviewState(db: Pick<Db, "select">, invoiceId: string) {
  const findings = await db
    .select({ id: t.findings.id, severity: t.findings.severity })
    .from(t.findings)
    .where(
      and(
        eq(t.findings.invoiceId, invoiceId),
        eq(t.findings.configVersion, CONFIG_VERSION),
      ),
    )
    .orderBy(t.findings.id);
  const explanation = await latestExplanation(db, invoiceId);
  const [lastDecision] = await db
    .select({ id: t.decisions.id })
    .from(t.decisions)
    .where(eq(t.decisions.invoiceId, invoiceId))
    .orderBy(desc(t.decisions.decidedAt), desc(t.decisions.id))
    .limit(1);
  const version = sha256(
    canonicalJson({
      findings,
      explanationId: explanation?.explanation.id ?? null,
      lastDecisionId: lastDecision?.id ?? null,
    }),
  );
  return {
    version,
    findings,
    explanation,
    lastDecisionId: lastDecision?.id ?? null,
  };
}
