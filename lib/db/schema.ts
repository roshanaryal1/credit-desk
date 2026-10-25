import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Ids are readable, prefixed strings (for example "inv_0042") so the agent can
// cite them and analysts can recognise them. Money is integer cents, rates are
// basis points, business dates are YYYY-MM-DD and instants are UTC (SPEC 4.1).

const businessDate = (name: string) => date(name, { mode: "string" });
const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
const cents = (name: string) => integer(name);

export const ledgerStatus = pgEnum("ledger_status", [
  "AUTHORISED",
  "PAID",
  "VOIDED",
]);
export const batchStatus = pgEnum("batch_status", ["PENDING", "REVIEWED"]);
export const adjustmentKind = pgEnum("adjustment_kind", [
  "COLLECTION",
  "DILUTION",
  "WRITE_OFF",
]);
export const severity = pgEnum("severity", ["LOW", "MEDIUM", "HIGH"]);
export const subjectType = pgEnum("subject_type", ["INVOICE", "INCIDENT"]);
export const runStatus = pgEnum("run_status", ["PASSED", "FAILED", "ERROR"]);
export const recommendation = pgEnum("recommendation", [
  "APPROVE",
  "HOLD",
  "REJECT",
  "REQUEST_INFO",
]);
export const decisionValue = pgEnum("decision_value", [
  "APPROVE",
  "HOLD",
  "REJECT",
]);
export const reviewMode = pgEnum("review_mode", ["SHADOW", "ASSIST"]);
export const incidentStatus = pgEnum("incident_status", [
  "OPEN",
  "ACKNOWLEDGED",
  "RESOLVED",
  "REOPENED",
]);

// Reference data

export const clients = pgTable("clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  industry: text("industry").notNull(),
  advanceRateBps: integer("advance_rate_bps").notNull().default(8000),
  facilityLimitCents: cents("facility_limit_cents").notNull(),
  paymentTermsDays: integer("payment_terms_days").notNull(),
});

export const debtors = pgTable(
  "debtors",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    name: text("name").notNull(),
    nzbn: text("nzbn").notNull(),
    firstSeenDate: businessDate("first_seen_date").notNull(),
    creditBand: text("credit_band").notNull(),
  },
  (t) => [index("debtors_client_idx").on(t.clientId)],
);

// What the client's systems say (Xero- and Akahu-shaped)

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    invoiceNumber: text("invoice_number").notNull(),
    debtorId: text("debtor_id")
      .notNull()
      .references(() => debtors.id),
    amountCents: cents("amount_cents").notNull(),
    issueDate: businessDate("issue_date").notNull(),
    recordedDate: businessDate("recorded_date").notNull(),
    supersedesLedgerEntryId: text("supersedes_ledger_entry_id"),
  },
  (t) => [
    uniqueIndex("ledger_client_invoice_uq").on(t.clientId, t.invoiceNumber),
    index("ledger_debtor_idx").on(t.debtorId),
  ],
);

export const ledgerStatusEvents = pgTable(
  "ledger_status_events",
  {
    ledgerEntryId: text("ledger_entry_id")
      .notNull()
      .references(() => ledgerEntries.id),
    status: ledgerStatus("status").notNull(),
    effectiveDate: businessDate("effective_date").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ledgerEntryId, t.effectiveDate, t.status] }),
  ],
);

export const creditNotes = pgTable(
  "credit_notes",
  {
    id: text("id").primaryKey(),
    ledgerEntryId: text("ledger_entry_id")
      .notNull()
      .references(() => ledgerEntries.id),
    date: businessDate("date").notNull(),
    amountCents: cents("amount_cents").notNull(),
  },
  (t) => [index("credit_notes_ledger_idx").on(t.ledgerEntryId)],
);

export const bankTransactions = pgTable(
  "bank_transactions",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    date: businessDate("date").notNull(),
    amountCents: cents("amount_cents").notNull(),
    counterpartyName: text("counterparty_name").notNull(),
    reference: text("reference").notNull(),
  },
  (t) => [index("bank_client_date_idx").on(t.clientId, t.date)],
);

export const receiptAllocations = pgTable(
  "receipt_allocations",
  {
    bankTransactionId: text("bank_transaction_id")
      .notNull()
      .references(() => bankTransactions.id),
    ledgerEntryId: text("ledger_entry_id")
      .notNull()
      .references(() => ledgerEntries.id),
    amountCents: cents("amount_cents").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.bankTransactionId, t.ledgerEntryId] }),
    index("alloc_ledger_idx").on(t.ledgerEntryId),
  ],
);

export const debtorPayments = pgTable(
  "debtor_payments",
  {
    id: text("id").primaryKey(),
    debtorId: text("debtor_id")
      .notNull()
      .references(() => debtors.id),
    ledgerEntryId: text("ledger_entry_id").references(() => ledgerEntries.id),
    invoiceNumber: text("invoice_number").notNull(),
    issueDate: businessDate("issue_date").notNull(),
    paidDate: businessDate("paid_date").notNull(),
    amountCents: cents("amount_cents").notNull(),
  },
  (t) => [index("payments_debtor_paid_idx").on(t.debtorId, t.paidDate)],
);

// The lender's records

export const batches = pgTable(
  "batches",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    submittedDate: businessDate("submitted_date").notNull(),
    status: batchStatus("status").notNull(),
  },
  (t) => [index("batches_client_idx").on(t.clientId)],
);

export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id")
      .notNull()
      .references(() => batches.id),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    debtorId: text("debtor_id")
      .notNull()
      .references(() => debtors.id),
    // Not unique: a double submission is exactly what the DUP check detects.
    invoiceNumber: text("invoice_number").notNull(),
    issueDate: businessDate("issue_date").notNull(),
    dueDate: businessDate("due_date").notNull(),
    amountCents: cents("amount_cents").notNull(),
    description: text("description").notNull(),
  },
  (t) => [
    index("invoices_batch_idx").on(t.batchId),
    index("invoices_client_number_idx").on(t.clientId, t.invoiceNumber),
    index("invoices_debtor_idx").on(t.debtorId),
  ],
);

export const fundings = pgTable(
  "fundings",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
    fundedDate: businessDate("funded_date").notNull(),
    advanceCents: cents("advance_cents").notNull(),
  },
  (t) => [uniqueIndex("fundings_invoice_uq").on(t.invoiceId)],
);

export const fundingAdjustments = pgTable(
  "funding_adjustments",
  {
    id: text("id").primaryKey(),
    fundingId: text("funding_id")
      .notNull()
      .references(() => fundings.id),
    date: businessDate("date").notNull(),
    kind: adjustmentKind("kind").notNull(),
    amountCents: cents("amount_cents").notNull(),
  },
  (t) => [index("adjustments_funding_idx").on(t.fundingId, t.date)],
);

export const findings = pgTable(
  "findings",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
    checkId: text("check_id").notNull(),
    severity: severity("severity").notNull(),
    details: jsonb("details_json").notNull(),
    configVersion: text("config_version").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("findings_invoice_check_version_uq").on(
      t.invoiceId,
      t.checkId,
      t.configVersion,
    ),
  ],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    subjectType: subjectType("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    configVersion: text("config_version").notNull(),
    codeSha: text("code_sha").notNull(),
    attempts: integer("attempts").notNull(),
    status: runStatus("status").notNull(),
    tokensIn: integer("tokens_in").notNull(),
    tokensOut: integer("tokens_out").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    // The business date the run reasoned about: submission date for an
    // invoice, the incident detection date for an incident.
    asOfDate: businessDate("as_of_date"),
    // Legacy records default false; all newly captured runs require a manifest.
    evidenceManifestRequired: boolean("evidence_manifest_required").notNull().default(false),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (t) => [index("runs_subject_idx").on(t.subjectType, t.subjectId)],
);

export const explanations = pgTable(
  "explanations",
  {
    id: text("id").primaryKey(),
    agentRunId: text("agent_run_id")
      .notNull()
      .references(() => agentRuns.id),
    summary: text("summary").notNull(),
    riskLevel: severity("risk_level").notNull(),
    recommendation: recommendation("recommendation").notNull(),
    questionsForClient: jsonb("questions_for_client")
      .$type<string[]>()
      .notNull(),
    claims: jsonb("claims_json")
      .$type<{ text: string; evidenceIds: string[] }[]>()
      .notNull(),
    citedEvidenceIds: jsonb("cited_evidence_ids").$type<string[]>().notNull(),
    validationStatus: runStatus("validation_status").notNull(),
    validationErrors: jsonb("validation_errors").$type<string[]>().notNull(),
  },
  (t) => [uniqueIndex("explanations_run_uq").on(t.agentRunId)],
);

// Exact, canonical evidence delivered by read-only tools during each agent run.
// The manifest is inserted in the same transaction as the run and explanation.
export const agentEvidenceManifests = pgTable(
  "agent_evidence_manifests",
  {
    runId: text("run_id").primaryKey().references(() => agentRuns.id),
    clientId: text("client_id").notNull().references(() => clients.id),
    asOfDate: businessDate("as_of_date").notNull(),
    validatorVersion: text("validator_version").notNull(),
    canonicalJson: text("canonical_json").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (row) => [index("agent_evidence_client_idx").on(row.clientId)],
);

export const decisions = pgTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
    decision: decisionValue("decision").notNull(),
    reason: text("reason").notNull(),
    analystSessionId: text("analyst_session_id").notNull(),
    analystDisplayName: text("analyst_display_name").notNull(),
    mode: reviewMode("mode").notNull(),
    explanationIdAtDecision: text("explanation_id_at_decision").references(
      () => explanations.id,
    ),
    aiContentExposedBeforeDecision: boolean(
      "ai_content_exposed_before_decision",
    ).notNull(),
    reviewVersion: text("review_version").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    simulated: boolean("simulated").notNull(),
    decidedAt: instant("decided_at").notNull(),
  },
  (t) => [
    uniqueIndex("decisions_idempotency_uq").on(t.idempotencyKey),
    index("decisions_invoice_idx").on(t.invoiceId, t.decidedAt),
  ],
);

export const decisionSnapshots = pgTable("decision_snapshots", {
  decisionId: text("decision_id")
    .primaryKey()
    .references(() => decisions.id),
  // Canonical JSON stored as text: jsonb would reorder keys and break the hash.
  canonicalJson: text("canonical_json").notNull(),
  sha256: text("sha256").notNull(),
  prevSha256: text("prev_sha256"),
  schemaVersion: integer("schema_version").notNull(),
  createdAt: instant("created_at").notNull().defaultNow(),
});

// Analyst exposure to agent output, recorded before any decision (SPEC 9.1).
export const exposures = pgTable(
  "exposures",
  {
    sessionId: text("session_id").notNull(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
    exposedAt: instant("exposed_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.invoiceId] })],
);

// Portfolio Watch

export const incidents = pgTable(
  "incidents",
  {
    id: text("id").primaryKey(),
    incidentKey: text("incident_key").notNull(),
    ruleId: text("rule_id").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    debtorId: text("debtor_id").references(() => debtors.id),
    fundingId: text("funding_id").references(() => fundings.id),
    severity: severity("severity").notNull(),
    firstDetectedDate: businessDate("first_detected_date").notNull(),
    lastDetectedDate: businessDate("last_detected_date").notNull(),
  },
  (t) => [uniqueIndex("incidents_key_uq").on(t.incidentKey)],
);

export const watchDetections = pgTable(
  "watch_detections",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id").notNull(),
    incidentKey: text("incident_key").notNull(),
    asOfDate: businessDate("as_of_date").notNull(),
    details: jsonb("details_json").notNull(),
    configVersion: text("config_version").notNull(),
  },
  (t) => [
    uniqueIndex("detections_rule_key_date_uq").on(
      t.ruleId,
      t.incidentKey,
      t.asOfDate,
    ),
  ],
);

export const incidentEvents = pgTable(
  "incident_events",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id")
      .notNull()
      .references(() => incidents.id),
    status: incidentStatus("status").notNull(),
    note: text("note"),
    actor: text("actor").notNull(),
    occurredAt: instant("occurred_at").notNull(),
  },
  (t) => [index("incident_events_idx").on(t.incidentId, t.occurredAt)],
);

// Audit and operations

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    payload: jsonb("payload_json").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt)],
);

export const rateLimitEvents = pgTable(
  "rate_limit_events",
  {
    key: text("key").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (t) => [index("rate_limit_key_idx").on(t.key, t.createdAt)],
);

// Provider ingestion journal. Records are immutable once accepted.
export const ingestionEvents = pgTable(
  "ingestion_events",
  {
    id: text("id").primaryKey(),
    sourceKind: text("source_kind").notNull(),
    connectionId: text("connection_id").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    eventId: text("event_id").notNull(),
    entityId: text("entity_id").notNull(),
    effectiveDate: businessDate("effective_date").notNull(),
    observedAt: instant("observed_at").notNull(),
    payload: jsonb("payload_json").$type<unknown>().notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ingestion_event_identity_uq").on(
      t.sourceKind,
      t.connectionId,
      t.clientId,
      t.eventId,
    ),
    index("ingestion_client_asof_idx").on(
      t.clientId,
      t.effectiveDate,
      t.observedAt,
    ),
  ],
);

// Connection checkpoints must be mutable, unlike accepted source events.
export const ingestionCheckpoints = pgTable(
  "ingestion_checkpoints",
  {
    sourceKind: text("source_kind").notNull(),
    connectionId: text("connection_id").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    cursor: text("cursor"),
    lastSuccessAt: instant("last_success_at"),
    lastFailureAt: instant("last_failure_at"),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "ingestion_checkpoints_pk",
      columns: [t.sourceKind, t.connectionId, t.clientId],
    }),
  ],
);

// Durable, recoverable provider sync jobs (synthetic source runners only until
// provider consent, identity and credential controls are approved).
export const ingestionSyncJobs = pgTable(
  "ingestion_sync_jobs",
  {
    id: text("id").primaryKey(),
    sourceKind: text("source_kind").notNull(),
    connectionId: text("connection_id").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    state: text("state").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    nextAttemptAt: instant("next_attempt_at").notNull(),
    leaseToken: text("lease_token"),
    leaseUntil: instant("lease_until"),
    lastErrorCode: text("last_error_code"),
    lastErrorAt: instant("last_error_at"),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ingestion_sync_source_uq").on(
      t.sourceKind,
      t.connectionId,
      t.clientId,
    ),
    index("ingestion_sync_due_idx").on(t.state, t.nextAttemptAt),
    check(
      "sync_attempts_valid",
      sql`${t.attempts} >= 0 AND ${t.maxAttempts} > 0 AND ${t.attempts} <= ${t.maxAttempts}`,
    ),
    check(
      "sync_state_valid",
      sql`${t.state} IN ('PENDING', 'LEASED', 'SUCCEEDED', 'DEAD')`,
    ),
    check(
      "sync_lease_pair",
      sql`(${t.leaseToken} IS NULL) = (${t.leaseUntil} IS NULL)`,
    ),
    check(
      "sync_leased_has_token",
      sql`(${t.state} = 'LEASED') = (${t.leaseToken} IS NOT NULL)`,
    ),
  ],
);

// Proposed durable synthetic case workflow. Privileged routes remain disabled until
// verified OIDC sessions are enforced on every query and action.
export const creditCases = pgTable(
  "credit_cases",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    subjectType: subjectType("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    priority: severity("priority").notNull(),
    dueDate: businessDate("due_date"),
    state: text("state").notNull(),
    version: integer("version").notNull().default(0),
    ownerId: text("owner_id"),
    makerId: text("maker_id"),
    checkerId: text("checker_id"),
    decisionReason: text("decision_reason"),
    updatedAt: instant("updated_at").notNull(),
  },
  (t) => [
    index("credit_cases_client_state_idx").on(t.clientId, t.state),
    index("credit_cases_tenant_client_idx").on(t.tenantId, t.clientId),
    check("credit_case_version_valid", sql`${t.version} >= 0`),
    check(
      "credit_case_state_valid",
      sql`${t.state} IN ('NEW','ASSIGNED','IN_REVIEW','CHECKER_REVIEW','RETURNED','APPROVED','HELD','REJECTED','CLOSED')`,
    ),
    check(
      "credit_case_separation",
      sql`${t.checkerId} IS NULL OR ${t.makerId} IS NULL OR ${t.checkerId} <> ${t.makerId}`,
    ),
  ],
);

export const creditCaseEvents = pgTable(
  "credit_case_events",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => creditCases.id),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    version: integer("version").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    reason: text("reason"),
    occurredAt: instant("occurred_at").notNull(),
  },
  (t) => [
    uniqueIndex("credit_case_event_version_uq").on(t.caseId, t.version),
    index("credit_case_event_history_idx").on(t.caseId, t.occurredAt),
    check("credit_case_event_version_valid", sql`${t.version} >= 0`),
  ],
);

// Evaluation only

export const labels = pgTable("labels", {
  invoiceId: text("invoice_id")
    .primaryKey()
    .references(() => invoices.id),
  expectedCheckIds: jsonb("expected_check_ids").$type<string[]>().notNull(),
});

export const watchLabels = pgTable(
  "watch_labels",
  {
    ruleId: text("rule_id").notNull(),
    incidentKey: text("incident_key").notNull(),
    expectedFromDate: businessDate("expected_from_date").notNull(),
    expectedToDate: businessDate("expected_to_date").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ruleId, t.incidentKey] })],
);

/** Tables that must never be updated or deleted (SPEC 4.2). */
export const APPEND_ONLY_TABLES = [
  "agent_runs",
  "agent_evidence_manifests",
  "explanations",
  "decision_snapshots",
  "audit_events",
  "incident_events",
  "ingestion_events",
  "credit_case_events",
] as const;

export type NewClient = typeof clients.$inferInsert;
export type NewDebtor = typeof debtors.$inferInsert;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;
export type NewLedgerStatusEvent = typeof ledgerStatusEvents.$inferInsert;
export type NewCreditNote = typeof creditNotes.$inferInsert;
export type NewBankTransaction = typeof bankTransactions.$inferInsert;
export type NewReceiptAllocation = typeof receiptAllocations.$inferInsert;
export type NewDebtorPayment = typeof debtorPayments.$inferInsert;
export type NewBatch = typeof batches.$inferInsert;
export type NewInvoice = typeof invoices.$inferInsert;
export type NewFunding = typeof fundings.$inferInsert;
export type NewFundingAdjustment = typeof fundingAdjustments.$inferInsert;
export type NewLabel = typeof labels.$inferInsert;
export type NewWatchLabel = typeof watchLabels.$inferInsert;
