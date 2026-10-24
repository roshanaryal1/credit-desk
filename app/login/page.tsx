import { Suspense } from "react";
import {
  Activity,
  FileCheck2,
  Landmark,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

import { gateConfig } from "@/lib/auth";
import { publicDemoEnabled } from "@/lib/public-demo";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

const features = [
  {
    label: "AI invoice checking",
    description: "Flag mismatches with evidence-linked explanations.",
    icon: FileCheck2,
  },
  {
    label: "Portfolio monitoring",
    description: "Track synthetic risk incidents and exposure trends.",
    icon: Activity,
  },
  {
    label: "Client 360",
    description: "Explore fictional facilities, records and activity.",
    icon: UsersRound,
  },
  {
    label: "Trust & transparency",
    description: "Review audit history and replayable evidence.",
    icon: ShieldCheck,
  },
];

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <div
      data-login-page=""
      className="grid min-h-[calc(100dvh-33px)] w-full lg:grid-cols-[minmax(0,1fr)_minmax(460px,0.95fr)]"
    >
      <section
        aria-label="About Credit Desk"
        className="relative isolate overflow-hidden bg-[#081e36] px-7 py-10 text-white sm:px-10 lg:px-14 lg:py-14"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-16 -right-36 -z-10 h-[480px] w-[480px] rounded-full bg-blue-500/15 blur-[90px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-60 -left-32 -z-10 h-[450px] w-[450px] rounded-full bg-cyan-600/10 blur-[100px]"
        />
        <div className="flex items-center gap-3">
          <div className="flex h-7 items-end gap-1" aria-hidden="true">
            <span className="h-3 w-1.5 rounded-sm bg-blue-400" />
            <span className="h-5 w-1.5 rounded-sm bg-blue-500" />
            <span className="h-7 w-1.5 rounded-sm bg-blue-300" />
          </div>
          <span className="text-lg font-bold tracking-tight">CREDIT DESK</span>
        </div>
        <div className="mt-12 max-w-xl lg:mt-20">
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-[0.22em] text-blue-300 uppercase">
            <Landmark size={16} aria-hidden="true" /> Intelligent credit
            operations
          </p>
          <h1 className="text-4xl leading-[1.12] font-bold tracking-tight sm:text-5xl">
            Smarter credit decisions with{" "}
            <span className="text-blue-400">AI agents</span>
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-slate-300">
            Check invoices, monitor portfolios and explore evidence-backed
            credit insights in one connected workspace.
          </p>
          <div className="mt-10 grid gap-5">
            {features.map(({ label, description, icon: Icon }) => (
              <div key={label} className="flex gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-blue-300">
                  <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
                </div>
                <div>
                  <h2 className="font-semibold text-white">{label}</h2>
                  <p className="mt-1 max-w-sm text-sm leading-6 text-slate-300">
                    {description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-12 text-xs leading-5 text-slate-400 lg:mt-20">
          Synthetic demonstration only · No real credit decisions, customer
          accounts or transfers
        </p>
      </section>
      <section
        aria-label="Sign in to Credit Desk"
        className="flex items-start justify-center bg-white px-5 py-10 text-slate-900 sm:px-10 lg:items-center lg:px-14"
      >
        <div className="w-full max-w-xl">
          <div className="mb-6">
            <p className="mb-2 text-xs font-semibold tracking-[0.16em] text-blue-600 uppercase">
              Credit Desk
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-slate-950">
              Welcome back
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Sign in with your reviewer password, or explore a fictional demo
              account below.
            </p>
          </div>
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
  return (
    <LoginForm
      next={typeof sp.next === "string" ? sp.next : "/"}
      quickEnabled={publicDemoEnabled() && gateConfig().configured}
    />
  );
}
