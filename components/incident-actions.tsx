"use client";

import { useActionState, useId } from "react";

import { incidentAction, type IncidentState } from "@/app/actions";

export function IncidentActions({
  incidentId,
  status,
}: {
  incidentId: string;
  status: string;
}) {
  const [state, action, pending] = useActionState<IncidentState, FormData>(
    incidentAction,
    { status: "idle" },
  );
  const noteId = useId();
  if (status === "RESOLVED") return null;
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="incidentId" value={incidentId} />
      <label htmlFor={noteId} className="text-sm font-medium">
        Note
      </label>
      <textarea
        id={noteId}
        name="note"
        rows={2}
        className="bg-background focus-visible:ring-ring rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        placeholder="What you checked or what happens next (required to resolve)"
      />
      <div className="flex gap-2">
        {status !== "ACKNOWLEDGED" ? (
          <button
            name="action"
            value="ACKNOWLEDGED"
            disabled={pending}
            className="hover:bg-accent focus-visible:ring-ring rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
          >
            Acknowledge
          </button>
        ) : null}
        <button
          name="action"
          value="RESOLVED"
          disabled={pending}
          className="bg-primary text-primary-foreground focus-visible:ring-ring rounded-md px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50"
        >
          Resolve
        </button>
      </div>
      <p
        role="status"
        aria-live="polite"
        className={
          state.status === "error"
            ? "text-destructive text-sm"
            : "text-muted-foreground text-sm"
        }
      >
        {state.message}
      </p>
    </form>
  );
}
