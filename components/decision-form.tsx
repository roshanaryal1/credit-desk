"use client";

import { useActionState, useId, useState } from "react";

import { decideAction, type DecideState } from "@/app/actions";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "APPROVE", label: "Approve" },
  { value: "HOLD", label: "Hold" },
  { value: "REJECT", label: "Reject" },
] as const;

export function DecisionForm({
  invoiceId,
  reviewVersion,
  hasHighRiskFindings,
}: {
  invoiceId: string;
  reviewVersion: string;
  hasHighRiskFindings: boolean;
}) {
  const [state, action, pending] = useActionState<DecideState, FormData>(
    decideAction,
    { status: "idle" },
  );
  const [choice, setChoice] = useState<string>("");
  // One key per form render: a double submit is saved once (SPEC 9.3).
  const [key] = useState(() => crypto.randomUUID());
  const reasonId = useId();
  const isHighRiskOverride = choice === "APPROVE" && hasHighRiskFindings;
  const needsReason = choice === "HOLD" || choice === "REJECT" || isHighRiskOverride;

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="reviewVersion" value={reviewVersion} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Your decision</legend>
        <div className="grid grid-cols-3 gap-2">
          {OPTIONS.map((o) => (
            <label
              key={o.value}
              className={cn(
                "has-[:focus-visible]:ring-ring cursor-pointer rounded-md border px-3 py-2 text-center text-sm has-[:focus-visible]:ring-2",
                choice === o.value
                  ? "border-primary bg-accent font-medium"
                  : "hover:bg-accent/60",
              )}
            >
              <input
                type="radio"
                name="decision"
                value={o.value}
                className="sr-only"
                checked={choice === o.value}
                onChange={() => setChoice(o.value)}
                required
              />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor={reasonId} className="text-sm font-medium">
          Reason {isHighRiskOverride ? "(required — HIGH-risk override)" : needsReason ? "(required)" : "(optional)"}
        </label>
        <textarea
          id={reasonId}
          name="reason"
          rows={3}
          required={needsReason}
          minLength={needsReason ? 5 : undefined}
          aria-invalid={state.fieldErrors?.reason ? true : undefined}
          aria-describedby={
            state.fieldErrors?.reason ? `${reasonId}-error` : undefined
          }
          className="bg-background focus-visible:ring-ring rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          placeholder={
            needsReason
              ? isHighRiskOverride
                ? "Why is approval justified despite the HIGH-risk findings?"
                : "What would change your mind?"
              : "Anything worth noting for the record"
          }
        />
        {state.fieldErrors?.reason ? (
          <p id={`${reasonId}-error`} className="text-destructive text-sm">
            {state.fieldErrors.reason}
          </p>
        ) : null}
      </div>
      <button
        type="submit"
        disabled={pending || !choice}
        className="bg-primary text-primary-foreground focus-visible:ring-ring rounded-md px-4 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50"
      >
        {pending ? "Saving..." : "Save decision"}
      </button>
      <p
        role="status"
        aria-live="polite"
        className={cn(
          "text-sm",
          state.status === "error"
            ? "text-destructive"
            : "text-muted-foreground",
        )}
      >
        {state.message}
      </p>
    </form>
  );
}
