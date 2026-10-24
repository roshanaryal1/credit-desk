/** Pure, non-mutating synthetic demo readiness assessment. */
export const REQUIRED_DEMO_TABLES = [
  "clients",
  "debtors",
  "invoices",
  "batches",
  "ledger_entries",
  "receipt_allocations",
  "credit_notes",
  "findings",
  "decisions",
  "decision_snapshots",
  "incidents",
  "incident_events",
  "watch_detections",
  "audit_events",
  "credit_cases",
  "credit_case_events",
] as const;

export interface DemoPreflightInput {
  foundTables: string[];
  clientCount: number;
  invoiceCount: number;
  batchCount: number;
  findingCount: number;
  pinnedClientFound: boolean;
  migrationJournalFound: boolean;
}

export function assessDemoReadiness(input: DemoPreflightInput) {
  const found = new Set(input.foundTables);
  const missing = REQUIRED_DEMO_TABLES.filter((name) => !found.has(name));
  const counts = [
    input.clientCount,
    input.invoiceCount,
    input.batchCount,
    input.findingCount,
  ];
  if (counts.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("Invalid preflight count");
  }
  const checks = {
    schema: missing.length === 0,
    migrations: input.migrationJournalFound,
    clients: input.clientCount > 0,
    invoices: input.invoiceCount > 0,
    batches: input.batchCount > 0,
    findings: input.findingCount > 0,
    fictionalClient: input.pinnedClientFound,
  };
  const failures = [
    ...(missing.length
      ? ["Missing required tables: " + missing.join(", ")]
      : []),
    ...(!checks.migrations ? ["Migration journal unavailable"] : []),
    ...(!checks.clients ? ["No client fixture rows"] : []),
    ...(!checks.invoices ? ["No invoice fixture rows"] : []),
    ...(!checks.batches ? ["No batch fixture rows"] : []),
    ...(!checks.findings ? ["No deterministic findings"] : []),
    ...(!checks.fictionalClient ? ["Pinned demo borrower absent"] : []),
  ];
  return {
    readyForSyntheticSmoke: failures.length === 0,
    checks,
    failures,
    warnings: [
      "Row counts do not prove that underlying data is synthetic.",
      "Pass does not prove hosted authentication, connection binding or lending policy.",
      "Migrations, seeding and deployment require separate owner approval.",
    ],
  };
}
