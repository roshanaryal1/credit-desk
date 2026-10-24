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
import {
  DEMO_PERSONA_KEYS,
  DEMO_PERSONAS,
  demoRouteAllowed,
} from "@/lib/demo-personas";
import { MODE_COOKIE } from "@/lib/session";
import { takeAll } from "@/lib/rate-limit";
import { clientIp, safeNext } from "@/lib/request";

const LoginSchema = z.object({
  password: z.string().min(1).max(200),
  name: z.string().trim().min(2, "Enter a name for the audit log.").max(60),
  next: z.string().max(500).optional(),
  persona: z.enum(DEMO_PERSONA_KEYS),
});

export interface LoginState {
  message?: string;
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

export async function loginAction(
  _prev: LoginState,
  form: FormData,
): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    password: form.get("password"),
    name: form.get("name"),
    next: form.get("next") ?? undefined,
    persona: form.get("persona"),
  });
  if (!parsed.success)
    return { message: parsed.error.issues[0]?.message ?? "Check the form." };

  const gate = gateConfig();
  if (!gate.configured)
    return { message: "Sign-in is not configured on this deployment." };

  const ip = clientIp(await headers());
  const db = await getDb();
  // Each attempt is reserved atomically before the password is checked, so
  // concurrent guesses cannot exceed the limit.
  const allowed = await takeAll(db, [
    { key: `login:${ip}`, max: LOGIN_MAX_ATTEMPTS, windowMs: LOGIN_WINDOW_MS },
    // A global cap holds even when no trusted client address is available.
    { key: "login:global", max: 200, windowMs: LOGIN_WINDOW_MS },
  ]);
  if (!allowed)
    return { message: "Too many attempts. Try again in 15 minutes." };
  if (!(await safeEqual(parsed.data.password, gate.password))) {
    return { message: "That password is not right." };
  }

  const token = await signSession(
    {
      sid: crypto.randomUUID(),
      name: parsed.data.name,
      persona: parsed.data.persona,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    },
    gate.secret,
  );
  const jar = await cookies();
  // A new session starts in shadow mode (SPEC 9.1).
  jar.delete(MODE_COOKIE);
  jar.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  const requested = safeNext(parsed.data.next);
  const path = new URL(requested, "https://demo.invalid").pathname;
  redirect(
    demoRouteAllowed(parsed.data.persona, path)
      ? requested
      : DEMO_PERSONAS[parsed.data.persona].home,
  );
}

export async function logoutAction() {
  (await cookies()).delete(AUTH_COOKIE);
  redirect("/login");
}
