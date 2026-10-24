"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { cookies } from "next/headers";

import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { providerFromEnv } from "@/lib/agent/config";
import { OpenAiCompatibleClient } from "@/lib/agent/llm";
import { runAgentForInvoice } from "@/lib/agent/runner";
import { getDb } from "@/lib/db/client";
import { takeAll } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import * as t from "@/lib/db/schema";
import { MODE_COOKIE, currentAnalyst } from "@/lib/session";
import { canPerformDemoWrite } from "@/lib/demo-session";
import { DecisionInputSchema, saveDecision } from "@/lib/trust/decide";

export interface DecideState {
  status: "idle" | "saved" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

const CODE_SHA = process.env.VERCEL_GIT_COMMIT_SHA ?? "local";

export async function decideAction(
  _prev: DecideState,
  form: FormData,
): Promise<DecideState> {
  if (!(await canPerformDemoWrite())) {
    return {
      status: "error",
      message: "Only the credit analyst demo can record synthetic decisions.",
    };
  }
  const parsed = DecisionInputSchema.safeParse({
    invoiceId: form.get("invoiceId"),
    decision: form.get("decision"),
    reason: form.get("reason") ?? "",
    reviewVersion: form.get("reviewVersion"),
    idempotencyKey: form.get("idempotencyKey"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      fieldErrors[String(issue.path[0] ?? "form")] = issue.message;
    return {
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors,
    };
  }
  const analyst = await currentAnalyst();
  const result = await saveDecision(await getDb(), parsed.data, analyst, {
    codeSha: CODE_SHA,
  });
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/", "layout");
  return {
    status: "saved",
    message: result.duplicate ? "Already saved." : "Decision saved.",
  };
}

export async function setModeAction(mode: "SHADOW" | "ASSIST") {
  if (!(await canPerformDemoWrite())) return;
  const jar = await cookies();
  jar.set(MODE_COOKIE, mode === "ASSIST" ? "ASSIST" : "SHADOW", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  revalidatePath("/", "layout");
}

const IncidentActionSchema = z.object({
  incidentId: z.string().min(1).max(200),
  action: z.enum(["ACKNOWLEDGED", "RESOLVED"]),
  note: z.string().trim().max(1000),
});

export interface IncidentState {
  status: "idle" | "saved" | "error";
  message?: string;
}

/** Acknowledge or resolve an incident with a note; audited in one transaction. */
export async function incidentAction(
  _prev: IncidentState,
  form: FormData,
): Promise<IncidentState> {
  if (!(await canPerformDemoWrite())) {
    return { status: "error", message: "This demo perspective is read-only." };
  }
  const parsed = IncidentActionSchema.safeParse({
    incidentId: form.get("incidentId"),
    action: form.get("action"),
    note: form.get("note") ?? "",
  });
  if (!parsed.success)
    return { status: "error", message: "That action is not valid." };
  if (parsed.data.action === "RESOLVED" && parsed.data.note.length < 5) {
    return {
      status: "error",
      message: "Add a note of at least 5 characters to resolve.",
    };
  }
  const analyst = await currentAnalyst();
  const db = await getDb();
  const ok = await db.transaction(async (tx) => {
    // Serialise competing transitions on the same incident.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${parsed.data.incidentId}))`,
    );
    const [incident] = await tx
      .select()
      .from(t.incidents)
      .where(eq(t.incidents.id, parsed.data.incidentId));
    if (!incident) return false;
    const [latest] = await tx
      .select({ status: t.incidentEvents.status })
      .from(t.incidentEvents)
      .where(eq(t.incidentEvents.incidentId, incident.id))
      .orderBy(desc(t.incidentEvents.occurredAt))
      .limit(1);
    // Resolved incidents only reopen through a new detection; an analyst
    // action on a stale screen must not undo a resolution.
    if (latest?.status === "RESOLVED") return "resolved" as const;
    if (latest?.status === parsed.data.action) return true;
    const actor = `${analyst.displayName} (${analyst.sessionId.slice(0, 8)})`;
    const id = `iev_${incident.id}_${crypto.randomUUID().slice(0, 8)}`;
    await tx.insert(t.incidentEvents).values({
      id,
      incidentId: incident.id,
      status: parsed.data.action,
      note: parsed.data.note || null,
      actor,
      occurredAt: new Date(),
    });
    await tx.insert(t.auditEvents).values({
      id: `aud_${id}`,
      actor,
      action: `INCIDENT_${parsed.data.action}`,
      entityType: "incident",
      entityId: incident.id,
      payload: {
        ruleId: incident.ruleId,
        note: parsed.data.note,
        reason: parsed.data.note || undefined,
      },
    });
    return true;
  });
  if (ok === "resolved")
    return {
      status: "error",
      message:
        "Someone already resolved this incident. Reload to see the latest history.",
    };
  if (!ok) return { status: "error", message: "Incident not found." };
  revalidatePath("/", "layout");
  return {
    status: "saved",
    message: parsed.data.action === "RESOLVED" ? "Resolved." : "Acknowledged.",
  };
}

const HOUR = 60 * 60 * 1000;

/**
 * Re-runs the agent for one invoice (SPEC 11): 10 per hour per session, 10
 * per hour per IP, and 200 per day across the app, counted in Postgres.
 */
export async function rerunAgentAction(
  invoiceId: string,
): Promise<{ ok: boolean; message: string }> {
  if (!(await canPerformDemoWrite())) {
    return { ok: false, message: "This demo perspective cannot run agents." };
  }
  if (
    typeof invoiceId !== "string" ||
    !/^inv_[a-z0-9_]{1,40}$/i.test(invoiceId)
  ) {
    return { ok: false, message: "That invoice id is not valid." };
  }
  const analyst = await currentAnalyst();
  const ip = clientIp(await headers());
  const db = await getDb();
  const allowed = await takeAll(db, [
    { key: `rerun:session:${analyst.sessionId}`, max: 10, windowMs: HOUR },
    { key: `rerun:ip:${ip}`, max: 10, windowMs: HOUR },
    { key: "rerun:global", max: 200, windowMs: 24 * HOUR },
  ]);
  if (!allowed)
    return {
      ok: false,
      message:
        "Re-run limit reached. The stored explanation is still shown; try again later.",
    };
  let llm: OpenAiCompatibleClient;
  try {
    llm = new OpenAiCompatibleClient(providerFromEnv());
  } catch {
    return {
      ok: false,
      message: "The agent is not configured on this deployment.",
    };
  }
  const out = await runAgentForInvoice(db, llm, invoiceId, {
    codeSha: CODE_SHA,
  });
  revalidatePath("/", "layout");
  const messages: Record<string, string> = {
    PASSED: "New explanation passed validation.",
    FAILED:
      "The new explanation failed validation twice and is not shown. The raw findings are unchanged.",
    ERROR:
      "The agent could not finish within its time budget. Try again shortly.",
    SKIPPED: "This invoice has no findings, so the agent does not run on it.",
  };
  return {
    ok: out.status === "PASSED",
    message: messages[out.status] ?? out.status,
  };
}
