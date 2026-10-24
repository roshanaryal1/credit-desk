import { cn } from "@/lib/utils";

// Status and severity always carry text as well as colour (SPEC 10).

const TONES = {
  clear: "bg-status-clear-bg text-status-clear",
  flagged: "bg-status-flagged-bg text-status-flagged",
  high: "bg-status-high-bg text-status-high",
  info: "bg-status-info-bg text-status-info",
  neutral: "bg-muted text-muted-foreground",
} as const;

export type Tone = keyof typeof TONES;

export function Chip({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATUS: Record<string, { tone: Tone; label: string }> = {
  CLEAR: { tone: "clear", label: "Clear" },
  FLAGGED: { tone: "flagged", label: "Flagged" },
  HIGH_RISK: { tone: "high", label: "High risk" },
};

export function StatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? { tone: "neutral" as Tone, label: status };
  return <Chip tone={s.tone}>{s.label}</Chip>;
}

const SEVERITY: Record<string, { tone: Tone; label: string }> = {
  HIGH: { tone: "high", label: "High" },
  MEDIUM: { tone: "flagged", label: "Medium" },
  LOW: { tone: "info", label: "Low" },
};

export function SeverityChip({ severity }: { severity: string }) {
  const s = SEVERITY[severity] ?? { tone: "neutral" as Tone, label: severity };
  return <Chip tone={s.tone}>{s.label}</Chip>;
}

const DECISION: Record<string, { tone: Tone; label: string }> = {
  APPROVE: { tone: "clear", label: "Approved" },
  HOLD: { tone: "flagged", label: "On hold" },
  REJECT: { tone: "high", label: "Rejected" },
  REQUEST_INFO: { tone: "info", label: "Request info" },
};

export function DecisionChip({ decision }: { decision: string }) {
  const s = DECISION[decision] ?? { tone: "neutral" as Tone, label: decision };
  return <Chip tone={s.tone}>{s.label}</Chip>;
}

const RECOMMENDATION: Record<string, { tone: Tone; label: string }> = {
  APPROVE: { tone: "clear", label: "Approve" },
  HOLD: { tone: "flagged", label: "Hold" },
  REJECT: { tone: "high", label: "Reject" },
  REQUEST_INFO: { tone: "info", label: "Request info" },
};

/** What the agent suggested (present tense), as opposed to what was decided. */
export function RecommendationChip({
  recommendation,
}: {
  recommendation: string;
}) {
  const s = RECOMMENDATION[recommendation] ?? {
    tone: "neutral" as Tone,
    label: recommendation,
  };
  return <Chip tone={s.tone}>{s.label}</Chip>;
}
