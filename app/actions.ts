"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { MODE_COOKIE, currentAnalyst } from "@/lib/session";
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
