import { Suspense } from "react";

import { gateConfig } from "@/lib/auth";
import { authMode } from "@/lib/identity/config";
import { safeNext } from "@/lib/request";
import { publicDemoEnabled } from "@/lib/public-demo";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

const SIGN_IN_ERRORS: Record<string, string> = {
  expired: "The sign-in attempt expired. Please try again.",
  sign_in_failed: "Sign-in could not be completed. Please try again.",
  mfa_required:
    "Your organisation sign-in did not include multi-factor authentication.",
  not_provisioned:
    "Your account has not been given access to Credit Desk. Contact an administrator.",
  disabled: "Your Credit Desk access has been disabled.",
  identity_conflict:
    "This sign-in is linked to a different Credit Desk account. Contact an administrator.",
  rate_limited: "Too many sign-in attempts. Please wait and try again.",
};

const areas = [
  {
    name: "Invoice Check",
    detail:
      "Deterministic checks flag each invoice in a funding batch, with the records behind every flag.",
  },
  {
    name: "Portfolio Watch",
    detail:
      "Daily rules surface concentration, ageing and payment-behaviour incidents across the book.",
  },
  {
    name: "Trust Panel",
    detail:
      "Analyst and AI agreement, and an exact replay of every recorded decision.",
  },
];

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <div
      data-login-page=""
      className="grid min-h-[calc(100dvh-33px)] w-full bg-white lg:grid-cols-[minmax(0,1fr)_minmax(480px,1fr)]"
    >
      <section
        aria-label="About Credit Desk"
        className="flex flex-col bg-slate-950 px-6 py-8 text-slate-100 sm:px-10 lg:px-14 lg:py-12"
      >
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-xs font-bold text-slate-950"
          >
            CD
          </span>
          <span className="text-base font-semibold">Credit Desk</span>
        </div>
        <div className="mt-10 max-w-lg lg:mt-auto">
          <p className="text-sm text-slate-400">Invoice finance operations</p>
          <h1 className="mt-3 text-2xl leading-snug font-semibold text-white sm:text-3xl">
            Review funding batches with evidence you can verify.
          </h1>
          <p className="mt-4 text-sm leading-6 text-slate-300">
            Deterministic checks flag invoice risk. An AI assistant explains
            each flag and must cite the source records; a validator rejects
            anything it cannot ground. A credit analyst makes every decision.
          </p>
          <dl className="mt-8 hidden divide-y divide-slate-800 border-y border-slate-800 sm:block">
            {areas.map((area) => (
              <div key={area.name} className="py-4">
                <dt className="text-sm font-medium text-white">{area.name}</dt>
                <dd className="mt-1 text-sm leading-6 text-slate-400">
                  {area.detail}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="mt-8 max-w-lg text-xs leading-5 text-slate-500 lg:mt-auto">
          Synthetic demonstration environment. All companies, invoices and
          decisions are fictional; nothing is funded or transferred.
        </p>
      </section>
      <section
        aria-label="Sign in to Credit Desk"
        className="flex items-start justify-center px-6 py-10 text-slate-900 sm:px-10 lg:items-center lg:px-14"
      >
        <div className="w-full max-w-md">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
            Sign in to Credit Desk
          </h2>
          <Suspense>
            <Form searchParams={searchParams} />
          </Suspense>
        </div>
      </section>
    </div>
  );
}

async function Form({
  searchParams,
}: {
  searchParams: PageProps<"/login">["searchParams"];
}) {
  const sp = await searchParams;
  // Rendered per request (after searchParams), never in the static shell, so
  // the sign-in mode always reflects the running configuration.
  const intro = (text: string) => (
    <p className="mt-2 mb-8 text-sm leading-6 text-slate-600">{text}</p>
  );
  if (authMode() === "oidc") {
    const next = safeNext(typeof sp.next === "string" ? sp.next : "/");
    // Only this page's own keys: "__proto__" and friends must not resolve.
    const error =
      typeof sp.error === "string" && Object.hasOwn(SIGN_IN_ERRORS, sp.error)
        ? SIGN_IN_ERRORS[sp.error]
        : undefined;
    return (
      <div className="space-y-4">
        {intro("Sign in with your organisation account.")}
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {error}
          </p>
        ) : null}
        <a
          href={`/auth/login?next=${encodeURIComponent(next)}`}
          className="flex w-full items-center justify-center rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Sign in with your organisation
        </a>
        <p className="text-sm text-slate-600">
          Access is limited to users an administrator has provisioned.
          Multi-factor authentication is required.
        </p>
      </div>
    );
  }
  return (
    <>
      {intro(
        "Choose a demo role to explore instantly, or sign in with a reviewer password.",
      )}
      <LoginForm
        next={typeof sp.next === "string" ? sp.next : "/"}
        quickEnabled={publicDemoEnabled() && gateConfig().configured}
      />
    </>
  );
}
