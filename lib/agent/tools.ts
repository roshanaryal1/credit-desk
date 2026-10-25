import { and, asc, desc, eq, gte, inArray, lte, or } from "drizzle-orm";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";

import { CONFIG_VERSION } from "@/lib/checks/config";
import { addDays, daysBetween } from "@/lib/dates";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

import { EvidenceRegistry, type EvidenceRecord } from "./evidence";
import { AgentOutputSchema } from "./schema";

// Read-only tools (SPEC 8). Every tool is scoped to the subject's client and
// only returns records effective on or before the subject's as-of date.
// Every returned record is registered as citable evidence for this run.

export interface ToolScope {
  clientId: string;
  asOf: string;
}

const Id = z.string().min(1).max(64);
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ARGS = {
  get_invoice: z.object({ invoice_id: Id }),
  get_ledger_entry: z.object({ invoice_id: Id }),
  get_bank_transactions: z.object({
    debtor_id: Id,
    from: DateStr,
    to: DateStr,
  }),
  get_debtor_history: z.object({ debtor_id: Id }),
  get_findings: z.object({ invoice_id: Id }),
  get_funding: z.object({ invoice_id: Id }),
  get_incident: z.object({ incident_id: z.string().min(1).max(200) }),
} as const;

export type ToolName = keyof typeof ARGS;

const DESCRIPTIONS: Record<ToolName, string> = {
  get_invoice: "Fetch a submitted invoice of this client by id.",
  get_ledger_entry:
    "Fetch the client's accounting ledger entry for a submitted invoice, with its status and credit notes as of the review date.",
  get_bank_transactions:
    "Fetch the client's bank receipts from a debtor between two dates (YYYY-MM-DD), with allocations to ledger entries.",
  get_debtor_history:
    "Fetch a debtor's profile and paid invoices in the 12 months before the review date, with days to pay.",
  get_findings:
    "Fetch the deterministic check findings for a submitted invoice.",
  get_funding:
    "Fetch the funding and repayments for an invoice, if it was funded.",
  get_incident:
    "Fetch a Portfolio Watch incident with the rule that raised it and what the rule measured on the latest detection.",
};

export const TOOL_DEFINITIONS: ChatCompletionTool[] = (
  Object.keys(ARGS) as ToolName[]
).map((name) => ({
  type: "function",
  function: {
    name,
    description: DESCRIPTIONS[name],
    parameters: z.toJSONSchema(ARGS[name]) as Record<string, unknown>,
  },
}));

/** The model submits its answer by calling this tool (SPEC 8 output). */
export const SUBMIT_TOOL_NAME = "submit_explanation";

export const SUBMIT_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: SUBMIT_TOOL_NAME,
    description:
      "Submit the final explanation once the investigation is complete. Every claim must cite record ids returned by the other tools.",
    parameters: z.toJSONSchema(AgentOutputSchema, { io: "input" }) as Record<
      string,
      unknown
    >,
  },
};

const cents = (n: number) => n / 100;

/** Most bank receipts one call returns. */
const BANK_LIMIT = 25;

export class ToolExecutor {
  constructor(
    private readonly db: Pick<Db, "select">,
    readonly scope: ToolScope,
    readonly evidence: EvidenceRegistry = new EvidenceRegistry(scope.clientId),
  ) {}

  /** Runs a tool call. Errors are returned as data so the model can recover. */
  async run(name: string, rawArgs: string): Promise<unknown> {
    if (!(name in ARGS)) return { error: `unknown tool ${name}` };
    let json: unknown;
    try {
      json = JSON.parse(rawArgs || "{}");
    } catch {
      return { error: "arguments are not valid JSON" };
    }
    const parsed = ARGS[name as ToolName].safeParse(json);
    if (!parsed.success)
      return { error: `invalid arguments: ${parsed.error.message}` };
    const tool = name as ToolName;
    switch (tool) {
      case "get_invoice":
        return this.getInvoice(
          (parsed.data as { invoice_id: string }).invoice_id,
        );
      case "get_ledger_entry":
        return this.getLedgerEntry(
          (parsed.data as { invoice_id: string }).invoice_id,
        );
      case "get_bank_transactions": {
        const a = parsed.data as {
          debtor_id: string;
          from: string;
          to: string;
        };
        return this.getBankTransactions(a.debtor_id, a.from, a.to);
      }
      case "get_debtor_history":
        return this.getDebtorHistory(
          (parsed.data as { debtor_id: string }).debtor_id,
        );
      case "get_findings":
        return this.getFindings(
          (parsed.data as { invoice_id: string }).invoice_id,
        );
      case "get_funding":
        return this.getFunding(
          (parsed.data as { invoice_id: string }).invoice_id,
        );
      case "get_incident":
        return this.getIncident(
          (parsed.data as { incident_id: string }).incident_id,
        );
      default: {
        // Compile-time check that every declared tool is dispatched.
        const unhandled: never = tool;
        return { error: `unhandled tool ${String(unhandled)}` };
      }
    }
  }

  private register<T extends EvidenceRecord>(record: T): T {
    this.evidence.add(record);
    return record;
  }

  private async scopedInvoice(invoiceId: string) {
    const [row] = await this.db
      .select({ invoice: t.invoices, submittedDate: t.batches.submittedDate })
      .from(t.invoices)
      .innerJoin(t.batches, eq(t.invoices.batchId, t.batches.id))
      .where(
        and(
          eq(t.invoices.id, invoiceId),
          eq(t.invoices.clientId, this.scope.clientId),
        ),
      );
    if (!row || row.submittedDate > this.scope.asOf) return null;
    return row;
  }

  async getInvoice(invoiceId: string) {
    const row = await this.scopedInvoice(invoiceId);
    if (!row)
      return { error: `invoice ${invoiceId} not found for this client` };
    const i = row.invoice;
    return this.register({
      id: i.id,
      clientId: i.clientId,
      type: "invoice",
      invoiceNumber: i.invoiceNumber,
      debtorId: i.debtorId,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      submittedDate: row.submittedDate,
      amount: cents(i.amountCents),
      description: i.description,
    });
  }

  async getLedgerEntry(invoiceId: string) {
    const row = await this.scopedInvoice(invoiceId);
    if (!row)
      return { error: `invoice ${invoiceId} not found for this client` };
    const [led] = await this.db
      .select()
      .from(t.ledgerEntries)
      .where(
        and(
          eq(t.ledgerEntries.clientId, this.scope.clientId),
          eq(t.ledgerEntries.invoiceNumber, row.invoice.invoiceNumber),
          lte(t.ledgerEntries.recordedDate, this.scope.asOf),
        ),
      );
    if (!led) return { found: false, invoiceNumber: row.invoice.invoiceNumber };
    const [status] = await this.db
      .select()
      .from(t.ledgerStatusEvents)
      .where(
        and(
          eq(t.ledgerStatusEvents.ledgerEntryId, led.id),
          lte(t.ledgerStatusEvents.effectiveDate, this.scope.asOf),
        ),
      )
      .orderBy(desc(t.ledgerStatusEvents.effectiveDate))
      .limit(1);
    const notes = await this.db
      .select()
      .from(t.creditNotes)
      .where(
        and(
          eq(t.creditNotes.ledgerEntryId, led.id),
          lte(t.creditNotes.date, this.scope.asOf),
        ),
      )
      .orderBy(asc(t.creditNotes.date));
    const creditNotes = notes.map((n) =>
      this.register({
        id: n.id,
        clientId: this.scope.clientId,
        type: "credit_note",
        ledgerEntryId: n.ledgerEntryId,
        date: n.date,
        amount: cents(n.amountCents),
      }),
    );
    return {
      found: true,
      entry: this.register({
        id: led.id,
        clientId: led.clientId,
        type: "ledger_entry",
        invoiceNumber: led.invoiceNumber,
        debtorId: led.debtorId,
        issueDate: led.issueDate,
        recordedDate: led.recordedDate,
        amount: cents(led.amountCents),
        status: status?.status ?? null,
        statusDate: status?.effectiveDate ?? null,
        supersedesLedgerEntryId: led.supersedesLedgerEntryId,
      }),
      creditNotes,
    };
  }

  async getBankTransactions(debtorId: string, from: string, to: string) {
    const [debtor] = await this.db
      .select()
      .from(t.debtors)
      .where(
        and(
          eq(t.debtors.id, debtorId),
          eq(t.debtors.clientId, this.scope.clientId),
        ),
      );
    if (!debtor)
      return { error: `debtor ${debtorId} not found for this client` };
    const end = to > this.scope.asOf ? this.scope.asOf : to;
    // Receipts from this debtor: those allocated to its ledger entries, plus
    // unallocated ones under its name. Newest first, so a long range keeps
    // the receipts nearest the review date.
    const allocated = this.db
      .select({ id: t.receiptAllocations.bankTransactionId })
      .from(t.receiptAllocations)
      .innerJoin(
        t.ledgerEntries,
        eq(t.receiptAllocations.ledgerEntryId, t.ledgerEntries.id),
      )
      .where(
        and(
          eq(t.ledgerEntries.debtorId, debtorId),
          eq(t.ledgerEntries.clientId, this.scope.clientId),
        ),
      );
    const matches = await this.db
      .select()
      .from(t.bankTransactions)
      .where(
        and(
          eq(t.bankTransactions.clientId, this.scope.clientId),
          or(
            inArray(t.bankTransactions.id, allocated),
            eq(t.bankTransactions.counterpartyName, debtor.name),
          ),
          gte(t.bankTransactions.date, from),
          lte(t.bankTransactions.date, end),
        ),
      )
      .orderBy(desc(t.bankTransactions.date), asc(t.bankTransactions.id))
      .limit(BANK_LIMIT + 1);
    const truncated = matches.length > BANK_LIMIT;
    const rows = matches.slice(0, BANK_LIMIT);
    const out = [];
    for (const b of rows) {
      const allocations = await this.db
        .select()
        .from(t.receiptAllocations)
        .where(eq(t.receiptAllocations.bankTransactionId, b.id));
      out.push(
        this.register({
          id: b.id,
          clientId: b.clientId,
          type: "bank_transaction",
          date: b.date,
          amount: cents(b.amountCents),
          counterpartyName: b.counterpartyName,
          reference: b.reference,
          allocations: allocations.map((a) => ({
            ledgerEntryId: a.ledgerEntryId,
            amount: cents(a.amountCents),
          })),
        }),
      );
    }
    return {
      debtorId,
      from,
      to: end,
      transactions: out,
      // The agent is told when results were cut, so it can narrow the range.
      truncated,
      ...(truncated
        ? {
            note: `Only the ${BANK_LIMIT} most recent receipts are shown; narrow the date range for older ones.`,
          }
        : {}),
    };
  }

  async getDebtorHistory(debtorId: string) {
    const [debtor] = await this.db
      .select()
      .from(t.debtors)
      .where(
        and(
          eq(t.debtors.id, debtorId),
          eq(t.debtors.clientId, this.scope.clientId),
        ),
      );
    if (!debtor)
      return { error: `debtor ${debtorId} not found for this client` };
    const payments = await this.db
      .select()
      .from(t.debtorPayments)
      .where(
        and(
          eq(t.debtorPayments.debtorId, debtorId),
          gte(t.debtorPayments.paidDate, addDays(this.scope.asOf, -365)),
          lte(t.debtorPayments.paidDate, this.scope.asOf),
        ),
      )
      .orderBy(asc(t.debtorPayments.paidDate));
    const rows = payments.map((p) =>
      this.register({
        id: p.id,
        clientId: this.scope.clientId,
        type: "debtor_payment",
        invoiceNumber: p.invoiceNumber,
        issueDate: p.issueDate,
        paidDate: p.paidDate,
        daysToPay: daysBetween(p.issueDate, p.paidDate),
        amount: cents(p.amountCents),
      }),
    );
    const mean =
      rows.length === 0
        ? null
        : Math.round(rows.reduce((s, r) => s + r.daysToPay, 0) / rows.length);
    return {
      debtor: this.register({
        id: debtor.id,
        clientId: debtor.clientId,
        type: "debtor",
        name: debtor.name,
        firstSeenDate: debtor.firstSeenDate,
        creditBand: debtor.creditBand,
      }),
      paymentsLast12Months: rows,
      meanDaysToPay: mean,
    };
  }

  async getFindings(invoiceId: string) {
    const row = await this.scopedInvoice(invoiceId);
    if (!row)
      return { error: `invoice ${invoiceId} not found for this client` };
    const rows = await this.db
      .select()
      .from(t.findings)
      .where(
        and(
          eq(t.findings.invoiceId, invoiceId),
          eq(t.findings.configVersion, CONFIG_VERSION),
        ),
      )
      .orderBy(asc(t.findings.checkId));
    return rows.map((f) =>
      this.register({
        id: f.id,
        clientId: this.scope.clientId,
        type: "finding",
        invoiceId: f.invoiceId,
        checkId: f.checkId,
        severity: f.severity,
        details: f.details,
      }),
    );
  }

  async getFunding(invoiceId: string) {
    const row = await this.scopedInvoice(invoiceId);
    if (!row)
      return { error: `invoice ${invoiceId} not found for this client` };
    const [f] = await this.db
      .select()
      .from(t.fundings)
      .where(
        and(
          eq(t.fundings.invoiceId, invoiceId),
          lte(t.fundings.fundedDate, this.scope.asOf),
        ),
      );
    if (!f) return { funded: false };
    const adjustments = await this.db
      .select()
      .from(t.fundingAdjustments)
      .where(
        and(
          eq(t.fundingAdjustments.fundingId, f.id),
          lte(t.fundingAdjustments.date, this.scope.asOf),
        ),
      )
      .orderBy(asc(t.fundingAdjustments.date));
    const repaid = adjustments.reduce((s, a) => s + a.amountCents, 0);
    return {
      funded: true,
      funding: this.register({
        id: f.id,
        clientId: this.scope.clientId,
        type: "funding",
        invoiceId: f.invoiceId,
        fundedDate: f.fundedDate,
        advance: cents(f.advanceCents),
        outstanding: cents(f.advanceCents - repaid),
      }),
      adjustments: adjustments.map((a) =>
        this.register({
          id: a.id,
          clientId: this.scope.clientId,
          type: "funding_adjustment",
          date: a.date,
          kind: a.kind,
          amount: cents(a.amountCents),
        }),
      ),
    };
  }

  async getIncident(incidentId: string) {
    const [incident] = await this.db
      .select()
      .from(t.incidents)
      .where(
        and(
          eq(t.incidents.id, incidentId),
          eq(t.incidents.clientId, this.scope.clientId),
        ),
      );
    if (!incident || incident.firstDetectedDate > this.scope.asOf) {
      return { error: `incident ${incidentId} not found for this client` };
    }
    const [detection] = await this.db
      .select()
      .from(t.watchDetections)
      .where(
        and(
          eq(t.watchDetections.incidentKey, incident.incidentKey),
          lte(t.watchDetections.asOfDate, this.scope.asOf),
        ),
      )
      .orderBy(desc(t.watchDetections.asOfDate))
      .limit(1);
    let invoiceId: string | null = null;
    if (incident.fundingId) {
      const [f] = await this.db
        .select({ invoiceId: t.fundings.invoiceId })
        .from(t.fundings)
        .where(eq(t.fundings.id, incident.fundingId));
      invoiceId = f?.invoiceId ?? null;
    }
    return this.register({
      id: incident.id,
      clientId: incident.clientId,
      type: "incident",
      ruleId: incident.ruleId,
      severity: incident.severity,
      debtorId: incident.debtorId,
      fundingId: incident.fundingId,
      invoiceId,
      firstDetectedDate: incident.firstDetectedDate,
      // The latest detection visible at the scope date, never a later one.
      lastDetectedDate: detection?.asOfDate ?? null,
      measured: detection?.details ?? null,
    });
  }
}
