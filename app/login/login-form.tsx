"use client";

import { useActionState } from "react";
import { ChevronRight } from "lucide-react";

import {
  DEMO_PERSONA_KEYS,
  DEMO_PERSONAS,
  demoCanWrite,
  type DemoPersona,
} from "@/lib/demo-personas";

import { loginAction, quickDemoAction, type LoginState } from "./actions";

// The analyst has the full write workflow, so it leads the list.
const DEMO_ORDER: DemoPersona[] = [
  "ANALYST",
  ...DEMO_PERSONA_KEYS.filter((key) => key !== "ANALYST"),
];

const input =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-900 focus:ring-1 focus:ring-slate-900";
const label = "mb-1 block text-sm font-medium text-slate-700";

export function LoginForm({
  next,
  quickEnabled,
}: {
  next: string;
  quickEnabled: boolean;
}) {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    loginAction,
    {},
  );
  const [demoState, demoAction, demoPending] = useActionState<
    LoginState,
    FormData
  >(quickDemoAction, {});

  return (
    <div className="space-y-10">
      <section aria-labelledby="quick-demo-title">
        <div className="flex items-baseline justify-between gap-4">
          <h3
            id="quick-demo-title"
            className="text-sm font-semibold text-slate-900"
          >
            Explore the demo
          </h3>
          <p className="text-xs text-slate-500">No password · 1 hour session</p>
        </div>
        {quickEnabled ? (
          <form
            action={demoAction}
            aria-label="One-click demo accounts"
            className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-md border border-slate-200"
          >
            {DEMO_ORDER.map((key) => {
              const writes = demoCanWrite(key);
              return (
                <button
                  key={key}
                  type="submit"
                  name="persona"
                  value={key}
                  disabled={demoPending}
                  className="flex w-full items-center gap-3 bg-white px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:relative focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-900 disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900">
                        {DEMO_PERSONAS[key].label}
                      </span>
                      <span
                        className={
                          writes
                            ? "rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200"
                            : "rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600"
                        }
                      >
                        {writes ? "Full workflow" : "View only"}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                      {DEMO_PERSONAS[key].description}
                    </span>
                  </span>
                  <ChevronRight
                    size={16}
                    className="shrink-0 text-slate-400"
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </form>
        ) : (
          <p
            role="status"
            className="mt-3 rounded-md border border-slate-200 p-3 text-sm text-slate-700"
          >
            Instant demo accounts are not enabled on this deployment. Use
            reviewer access below.
          </p>
        )}
        {demoPending && (
          <p role="status" className="mt-2 text-xs text-slate-600">
            Opening the demo…
          </p>
        )}
        {demoState.message && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {demoState.message}
          </p>
        )}
      </section>

      <section aria-labelledby="reviewer-title">
        <h3
          id="reviewer-title"
          className="text-sm font-semibold text-slate-900"
        >
          Reviewer access
        </h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          For invited reviewers with the shared password. Your name is shown on
          the decisions you record.
        </p>
        <form
          action={action}
          className="mt-4 space-y-4"
          aria-label="Reviewer sign in"
        >
          <input type="hidden" name="next" value={next} />
          <div>
            <label htmlFor="name" className={label}>
              Your name
            </label>
            <input
              id="name"
              name="name"
              required
              minLength={2}
              maxLength={60}
              autoComplete="name"
              className={input}
            />
          </div>
          <div>
            <label htmlFor="password" className={label}>
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={input}
            />
          </div>
          <div>
            <label htmlFor="persona" className={label}>
              Role
            </label>
            <select
              id="persona"
              name="persona"
              defaultValue="ANALYST"
              required
              className={input}
            >
              {DEMO_ORDER.map((key) => (
                <option key={key} value={key}>
                  {DEMO_PERSONAS[key].label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-60"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
          {state.message && (
            <p role="alert" className="text-sm text-red-700">
              {state.message}
            </p>
          )}
        </form>
      </section>

      <p className="text-xs leading-5 text-slate-500">
        Demo roles are labels for exploring the product, not verified
        identities. All data is fictional.
      </p>
    </div>
  );
}
