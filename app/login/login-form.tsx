"use client";

import { useActionState } from "react";

import { DEMO_PERSONA_KEYS, DEMO_PERSONAS } from "@/lib/demo-personas";

import { loginAction, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    loginAction,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Explore Credit Desk as</legend>
        <div className="grid gap-2">
          {DEMO_PERSONA_KEYS.map((key) => (
            <label key={key} className="border-border bg-card hover:bg-accent/40 flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary has-[:checked]:bg-accent/50">
              <input
                type="radio"
                name="persona"
                value={key}
                defaultChecked={key === "ANALYST"}
                required
                className="accent-primary mt-1"
              />
              <span>
                <span className="block text-sm font-semibold">{DEMO_PERSONAS[key].label}</span>
                <span className="text-muted-foreground block text-xs">{DEMO_PERSONAS[key].description}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          Personas are self-selected demonstrations, not verified identities.
          Only fictional data is permitted.
        </p>
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-sm font-medium">
          Your name
        </label>
        <input
          id="name"
          name="name"
          required
          minLength={2}
          maxLength={60}
          autoComplete="name"
          className="bg-background focus-visible:ring-ring rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        />
        <p className="text-muted-foreground text-xs">
          Shown in the audit log next to your decisions. It is not verified.
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="bg-background focus-visible:ring-ring rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        />
      </div>
      <button
        disabled={pending}
        className="bg-primary text-primary-foreground focus-visible:ring-ring rounded-md px-4 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50"
      >
        {pending ? "Signing in..." : "Sign in"}
      </button>
      <p role="status" aria-live="polite" className="text-destructive text-sm">
        {state.message}
      </p>
    </form>
  );
}
