import { Suspense } from "react";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Sign in to Credit Desk
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Choose a fictional perspective and enter the shared demonstration password. No real customer data or verified identity.
        </p>
      </div>
      <Suspense>
        <Form searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Form({
  searchParams,
}: {
  searchParams: PageProps<"/login">["searchParams"];
}) {
  const sp = await searchParams;
  return <LoginForm next={typeof sp.next === "string" ? sp.next : "/"} />;
}
