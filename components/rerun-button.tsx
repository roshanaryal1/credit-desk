"use client";

import { useState, useTransition } from "react";

import { rerunAgentAction } from "@/app/actions";

export function RerunButton({ invoiceId }: { invoiceId: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () =>
            setMessage((await rerunAgentAction(invoiceId)).message),
          )
        }
        className="hover:bg-accent focus-visible:ring-ring self-start rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
      >
        {pending ? "Running the agent..." : "Re-run agent"}
      </button>
      <p
        role="status"
        aria-live="polite"
        className="text-muted-foreground text-xs"
      >
        {message ?? "Calls the live model. Limited to 10 runs an hour."}
      </p>
    </div>
  );
}
