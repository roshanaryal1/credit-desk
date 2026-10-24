"use client";

import { useActionState } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  ClipboardCheck,
  FileSearch,
  ShieldCheck,
} from "lucide-react";

import { DEMO_PERSONA_KEYS, DEMO_PERSONAS } from "@/lib/demo-personas";
import { PUBLIC_DEMO_ACCOUNT_EMAILS } from "@/lib/public-demo";

import { loginAction, quickDemoAction, type LoginState } from "./actions";

const icons = {
  EMPLOYER: BriefcaseBusiness,
  ANALYST: ChartNoAxesCombined,
  CHECKER: ClipboardCheck,
  CLIENT: ShieldCheck,
  AUDITOR: FileSearch,
} as const;

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
  const [demoState, demoAction, demoPending] = useActionState<LoginState, FormData>(
    quickDemoAction,
    {},
  );

  return (
    <div className="space-y-7">
      <form action={action} className="space-y-4" aria-label="Reviewer sign in">
        <input type="hidden" name="next" value={next} />
        <div>
          <label htmlFor="name" className="mb-1.5 block text-sm font-semibold text-slate-800">
            Your name
          </label>
          <input id="name" name="name" required minLength={2} maxLength={60}
            autoComplete="name" placeholder="Enter your name"
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-semibold text-slate-800">
            Password
          </label>
          <input id="password" name="password" type="password" required
            autoComplete="current-password" placeholder="Your reviewer password"
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
        </div>
        <div>
          <label htmlFor="persona" className="mb-1.5 block text-sm font-semibold text-slate-800">
            Explore Credit Desk as
          </label>
          <select id="persona" name="persona" defaultValue="ANALYST" required
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100">
            {DEMO_PERSONA_KEYS.map((key) => (
              <option key={key} value={key}>{DEMO_PERSONAS[key].label}</option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60">
          {pending ? "Signing in..." : "Sign in as reviewer"}
          {!pending && <ArrowRight size={17} aria-hidden="true" />}
        </button>
        {state.message && <p role="alert" className="text-sm text-red-700">{state.message}</p>}
      </form>

      <section aria-labelledby="quick-demo-title" className="space-y-3">
        <div className="flex items-center gap-3 text-xs font-medium text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          <span>OR EXPLORE INSTANTLY</span>
          <span className="h-px flex-1 bg-slate-200" />
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-4 sm:p-5">
          <div className="mb-3">
            <h2 id="quick-demo-title" className="text-base font-bold text-slate-900">
              Try a demo account
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Choose a role below to sign in instantly. No password needed.
            </p>
          </div>
          {quickEnabled ? (
            <form action={demoAction} className="grid gap-2 sm:grid-cols-2" aria-label="One-click demo accounts">
              {DEMO_PERSONA_KEYS.map((key) => {
                const Icon = icons[key];
                return (
                  <button key={key} type="submit" name="persona" value={key}
                    disabled={demoPending}
                    aria-label={"Continue as " + DEMO_PERSONAS[key].label + " demo"}
                    className="group flex min-w-0 items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left transition-all hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                      <Icon size={19} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-900">
                        {DEMO_PERSONAS[key].label}
                      </span>
                      <span className="block truncate text-[11px] text-slate-500" title={PUBLIC_DEMO_ACCOUNT_EMAILS[key]}>
                        {PUBLIC_DEMO_ACCOUNT_EMAILS[key]}
                      </span>
                    </span>
                    <ArrowRight size={16} className="shrink-0 text-blue-600 group-hover:translate-x-0.5" aria-hidden="true" />
                  </button>
                );
              })}
            </form>
          ) : (
            <p className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700" role="status">
              Instant demo accounts are not enabled on this deployment. Use the reviewer sign-in above.
            </p>
          )}
          {demoPending && <p role="status" className="mt-3 text-xs text-blue-700">Opening the fictional demo...</p>}
          {demoState.message && <p role="alert" className="mt-3 text-sm text-red-700">{demoState.message}</p>}
          <p className="mt-3 text-[11px] leading-4 text-slate-500">
            Demo addresses are examples, not email inboxes. Public access is read-only and uses fictional data; roles do not verify identity or grant approval authority.
          </p>
        </div>
      </section>
    </div>
  );
}
