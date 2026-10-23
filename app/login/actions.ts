"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  AUTH_COOKIE,
  SESSION_TTL_SECONDS,
  gateConfig,
  safeEqual,
  signSession,
} from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { hitsSince, recordHit } from "@/lib/rate-limit";

const LoginSchema = z.object({
  password: z.string().min(1).max(200),
  name: z.string().trim().min(2, "Enter a name for the audit log.").max(60),
  next: z.string().max(500).optional(),
});

export interface LoginState {
  message?: string;
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

/** Only same-site relative paths are allowed as a post-login destination. */
function safeNext(next: string | undefined): string {
  return next &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.startsWith("/\\")
    ? next
    : "/";
}

export async function loginAction(
  _prev: LoginState,
  form: FormData,
): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    password: form.get("password"),
    name: form.get("name"),
    next: form.get("next") ?? undefined,
  });
  if (!parsed.success)
    return { message: parsed.error.issues[0]?.message ?? "Check the form." };

  const gate = gateConfig();
  if (!gate.configured)
    return { message: "Sign-in is not configured on this deployment." };

  const ip =
    (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const db = await getDb();
  const key = `login:${ip}`;
  if ((await hitsSince(db, key, LOGIN_WINDOW_MS)) >= LOGIN_MAX_FAILURES) {
    return { message: "Too many attempts. Try again in 15 minutes." };
  }
  if (!(await safeEqual(parsed.data.password, gate.password))) {
    await recordHit(db, key);
    return { message: "That password is not right." };
  }

  const token = await signSession(
    {
      sid: crypto.randomUUID(),
      name: parsed.data.name,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    },
    gate.secret,
  );
  (await cookies()).set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  redirect(safeNext(parsed.data.next));
}

export async function logoutAction() {
  (await cookies()).delete(AUTH_COOKIE);
  redirect("/login");
}
