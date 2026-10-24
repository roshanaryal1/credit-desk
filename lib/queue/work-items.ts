export interface BatchWork {
  id: string;
  status: string;
  clientName: string;
  submittedDate: string;
  highRisk: number;
  flagged: number;
  invoiceCount: number;
  faceCents: number;
}
export interface IncidentWork {
  id: string;
  clientName: string;
  severity: string;
  firstDetectedDate: string;
  status: string;
  ruleId: string;
}
export interface WorkItem {
  key: string;
  kind: "INVOICE_BATCH" | "RISK_INCIDENT";
  clientName: string;
  date: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  count: number;
  amountCents: number | null;
  amountLabel: string | null;
  href: string;
  nextStep: string;
  description: string;
}

const RANK: Record<WorkItem["severity"], number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

/** Read-only v1 triage projection, not the v2 assigned-case state machine. */
export function workItems(
  batches: BatchWork[],
  incidents: IncidentWork[],
  asOf: string,
): WorkItem[] {
  const invoice = batches
    .filter((x) => x.status === "PENDING" && x.submittedDate <= asOf)
    .map((x): WorkItem => ({
      key: `batch:${x.id}`,
      kind: "INVOICE_BATCH",
      clientName: x.clientName,
      date: x.submittedDate,
      severity: x.highRisk ? "HIGH" : x.flagged ? "MEDIUM" : "LOW",
      count: x.invoiceCount,
      amountCents: x.faceCents,
      amountLabel: "Batch face",
      href: `/batches/${encodeURIComponent(x.id)}`,
      nextStep: "Review invoice evidence",
      description: `${x.highRisk} high-risk · ${x.flagged} flagged invoices`,
    }));
  const risk = incidents
    .filter((x) => x.status !== "RESOLVED" && x.firstDetectedDate <= asOf)
    .map((x): WorkItem => ({
      key: `incident:${x.id}`,
      kind: "RISK_INCIDENT",
      clientName: x.clientName,
      date: x.firstDetectedDate,
      severity:
        x.severity === "HIGH"
          ? "HIGH"
          : x.severity === "MEDIUM"
            ? "MEDIUM"
            : "LOW",
      count: 1,
      amountCents: null,
      amountLabel: null,
      href: `/watch?asOf=${asOf}&incident=${encodeURIComponent(x.id)}`,
      nextStep: "Examine incident evidence",
      description: x.ruleId.replaceAll("_", " ").toLowerCase(),
    }));
  return [...invoice, ...risk].sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      a.date.localeCompare(b.date) ||
      a.key.localeCompare(b.key),
  );
}
