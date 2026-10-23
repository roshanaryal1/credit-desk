"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { getDb } from "@/lib/db/client";
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
