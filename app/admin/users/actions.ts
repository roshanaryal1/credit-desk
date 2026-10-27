"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/lib/db/client";
import {
  AccessInput,
  NewUserInput,
  provisionUser,
  setUserActive,
  updateAccess,
  type Admin,
} from "@/lib/identity/admin";
import { currentAdministrator } from "@/lib/identity/current";
import { revokeSessions } from "@/lib/identity/store";

export interface AdminState {
  status: "idle" | "saved" | "error";
  message?: string;
}

/** Administrator with MFA, from the verified session only (never form data). */
async function admin(): Promise<Admin | null> {
  const session = await currentAdministrator();
  return session
    ? { userId: session.userId, tenantId: session.identity.tenantId }
    : null;
}

const DENIED: AdminState = {
  status: "error",
  message: "Administrator access with multi-factor sign-in is required.",
};
const UserId = z.string().regex(/^usr_[A-Za-z0-9_-]{6,40}$/);

function access(form: FormData) {
  return AccessInput.safeParse({
    roles: form.getAll("roles"),
    clientIds: form.getAll("clientIds"),
  });
}

export async function provisionUserAction(
  _prev: AdminState,
  form: FormData,
): Promise<AdminState> {
  const actor = await admin();
  if (!actor) return DENIED;
  const parsed = NewUserInput.safeParse({
    email: form.get("email"),
    displayName: form.get("displayName"),
    roles: form.getAll("roles"),
    clientIds: form.getAll("clientIds"),
  });
  if (!parsed.success)
    return {
      status: "error",
      message: "Check the email, name, roles and clients.",
    };
  const result = await provisionUser(await getDb(), actor, parsed.data);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/admin/users");
  return {
    status: "saved",
    message: "User provisioned. They can now sign in.",
  };
}

export async function updateAccessAction(
  _prev: AdminState,
  form: FormData,
): Promise<AdminState> {
  const actor = await admin();
  if (!actor) return DENIED;
  const userId = UserId.safeParse(form.get("userId"));
  const parsed = access(form);
  if (!userId.success || !parsed.success)
    return { status: "error", message: "That change is not valid." };
  const result = await updateAccess(
    await getDb(),
    actor,
    userId.data,
    parsed.data,
  );
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/admin/users");
  return { status: "saved", message: "Access updated." };
}

export async function setActiveAction(
  _prev: AdminState,
  form: FormData,
): Promise<AdminState> {
  const actor = await admin();
  if (!actor) return DENIED;
  const userId = UserId.safeParse(form.get("userId"));
  const active = form.get("active");
  if (!userId.success || (active !== "true" && active !== "false"))
    return { status: "error", message: "That change is not valid." };
  const result = await setUserActive(
    await getDb(),
    actor,
    userId.data,
    active === "true",
    new Date(),
  );
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/admin/users");
  return {
    status: "saved",
    message:
      active === "true" ? "User enabled." : "User disabled and signed out.",
  };
}

export async function revokeSessionsAction(
  _prev: AdminState,
  form: FormData,
): Promise<AdminState> {
  const actor = await admin();
  if (!actor) return DENIED;
  const userId = UserId.safeParse(form.get("userId"));
  if (!userId.success)
    return { status: "error", message: "That change is not valid." };
  const db = await getDb();
  // Tenant check: only users of this administrator's tenant.
  const { listUsers } = await import("@/lib/identity/admin");
  const known = (await listUsers(db, actor.tenantId, new Date())).some(
    (u) => u.id === userId.data,
  );
  if (!known) return { status: "error", message: "User not found." };
  const n = await revokeSessions(
    db,
    { userId: userId.data },
    "ADMIN_REVOKE",
    `user:${actor.userId}`,
    new Date(),
  );
  revalidatePath("/admin/users");
  return {
    status: "saved",
    message: `${n} session${n === 1 ? "" : "s"} revoked.`,
  };
}
