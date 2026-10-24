"use client";

import { useTransition } from "react";

import { setModeAction } from "@/app/actions";

export function ModeSwitch({ mode }: { mode: "SHADOW" | "ASSIST" }) {
  const [pending, start] = useTransition();
  const next = mode === "SHADOW" ? "ASSIST" : "SHADOW";
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p>
        <span className="font-medium">
          {mode === "SHADOW" ? "Shadow mode" : "Assist mode"}
        </span>
        <span className="text-muted-foreground">
          {mode === "SHADOW"
            ? ": you decide first, then see the agent's view."
            : ": the agent's view is shown before you decide. These decisions do not count toward agreement."}
        </span>
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => setModeAction(next))}
        className="text-primary self-start text-sm underline underline-offset-4 disabled:opacity-50"
      >
        Switch to {next === "SHADOW" ? "shadow" : "assist"} mode
      </button>
    </div>
  );
}
