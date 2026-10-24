import { addDays, daysBetween, maxDate, minDate } from "@/lib/dates";
import { DEMO_TODAY } from "@/lib/demo";
import type * as s from "@/lib/db/schema";

import { CLIENT_PROFILES, debtorNames, syntheticNzbn } from "./names";
import { Rng } from "./prng";
import { applyReferenceLabels } from "./reference";

// Deterministic synthetic book (SPEC 5). `generate` is pure: the same params
// always produce the same dataset. Writing it to a database is a separate step.
//
// Labels start as the problems the generator injected. lib/seed/reference.ts
// then adds facts that depend on the whole book rather than one injection
// (ALREADY_PAID, CONCENTRATION, accidental duplicates) and derives every watch
// label, so correct detections are never scored as false positives.

export type ProblemType =
  | "DUP"
  | "LEDGER_MISSING"
  | "LEDGER_MISMATCH"
  | "VOIDED"
  | "CREDIT_NOTE"
  | "ALREADY_PAID"
  | "NEW_DEBTOR"
  | "SLOW_PAYER"
  | "OVER_AGE"
  | "FUTURE_DATED"
  | "CONCENTRATION";

export type CleanCase = "PARTIAL_PAYMENT" | "REISSUED";

export interface SeedParams {
  name: "dev" | "holdout";
  seed: number;
  demoToday: string;
  /** Target share of submitted invoices carrying at least one problem. */
  problemRate: number;
  /** Batch schedule: client index and days before demoToday. */
  batches: readonly { client: number; daysAgo: number }[];
  /** How many final batches are left PENDING for live review. */
  pendingBatches: number;
}

export const DEV_PARAMS: SeedParams = {
  name: "dev",
  seed: 20_261_023,
  demoToday: DEMO_TODAY,
  problemRate: 0.15,
  batches: [
    { client: 0, daysAgo: 84 },
    { client: 1, daysAgo: 76 },
    { client: 2, daysAgo: 68 },
    { client: 3, daysAgo: 55 },
    { client: 0, daysAgo: 41 },
    { client: 1, daysAgo: 27 },
    { client: 2, daysAgo: 3 },
    { client: 3, daysAgo: 1 },
  ],
  pendingBatches: 2,
};

/** Held-out dataset for evaluation only: different seed, rate and schedule. */
export const HOLDOUT_PARAMS: SeedParams = {
  name: "holdout",
  seed: 777_001,
  demoToday: DEMO_TODAY,
  problemRate: 0.18,
  batches: [
    { client: 2, daysAgo: 86 },
    { client: 3, daysAgo: 79 },
    { client: 0, daysAgo: 63 },
    { client: 1, daysAgo: 50 },
    { client: 2, daysAgo: 35 },
    { client: 3, daysAgo: 22 },
    { client: 0, daysAgo: 6 },
    { client: 1, daysAgo: 2 },
  ],
  pendingBatches: 2,
};

export interface ScriptedEvent {
  kind:
    | "PAYMENT_DRIFT"
    | "FUNDED_CREDIT_NOTE"
    | "OVERDUE_FUNDED"
    | "CONCENTRATION_CREEP";
  date: string;
  description: string;
}

export interface Dataset {
  params: SeedParams;
  clients: s.NewClient[];
  debtors: s.NewDebtor[];
  ledgerEntries: s.NewLedgerEntry[];
  ledgerStatusEvents: s.NewLedgerStatusEvent[];
  creditNotes: s.NewCreditNote[];
  bankTransactions: s.NewBankTransaction[];
  receiptAllocations: s.NewReceiptAllocation[];
  debtorPayments: s.NewDebtorPayment[];
  batches: s.NewBatch[];
  invoices: s.NewInvoice[];
  fundings: s.NewFunding[];
  fundingAdjustments: s.NewFundingAdjustment[];
  labels: s.NewLabel[];
  watchLabels: s.NewWatchLabel[];
  /** Clean but tricky invoices, by id, for reporting. */
  cleanCases: Record<string, CleanCase>;
  scriptedEvents: ScriptedEvent[];
}

interface DebtorProfile {
  id: string;
  clientIndex: number;
  /** Typical days from issue to payment. */
  baseDaysToPay: number;
  kind: "NORMAL" | "SLOW" | "NEW" | "DRIFT" | "CONCENTRATED";
}

interface WorkingInvoice {
  row: s.NewInvoice & { id: string };
  batchIndex: number;
  ledgerId: string | null;
  problems: Set<ProblemType>;
  /** Clean invoices in reviewed batches are funded. */
  fundable: boolean;
}

interface Exposure {
  debtorId: string;
  clientId: string;
  face: number;
  funded: string;
  collected: string | null;
}

const pad = (n: number, width = 4) => String(n).padStart(width, "0");
const INJECTABLE: ProblemType[] = [
  "DUP",
  "LEDGER_MISSING",
  "LEDGER_MISMATCH",
  "VOIDED",
  "CREDIT_NOTE",
  "ALREADY_PAID",
  "OVER_AGE",
  "FUTURE_DATED",
];

export function generate(params: SeedParams): Dataset {
  const rng = new Rng(params.seed);
  const today = params.demoToday;
  const p = params.name === "dev" ? "" : "h";
  const id = (prefix: string, n: number) => `${prefix}_${p}${pad(n)}`;

  const ds: Dataset = {
    params,
    clients: [],
    debtors: [],
    ledgerEntries: [],
    ledgerStatusEvents: [],
    creditNotes: [],
    bankTransactions: [],
    receiptAllocations: [],
    debtorPayments: [],
    batches: [],
    invoices: [],
    fundings: [],
    fundingAdjustments: [],
    labels: [],
    watchLabels: [],
    cleanCases: {},
    scriptedEvents: [],
  };

  const counters: Record<string, number> = {};
  const nextId = (prefix: string) => {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    return id(prefix, counters[prefix]);
  };

  // Clients and debtors

  const profiles: DebtorProfile[] = [];
  CLIENT_PROFILES.forEach((cp, ci) => {
    const clientId = id("cli", ci + 1);
    ds.clients.push({
      id: clientId,
      name: cp.name,
      industry: cp.industry,
      advanceRateBps: 8000,
      // Comfortably above expected use so facility alerts stay rare.
      facilityLimitCents: 150_000_000,
      paymentTermsDays: cp.termsDays,
    });
    const names = debtorNames(10, ci * 5 + (params.name === "dev" ? 0 : 2));
    names.forEach((name, di) => {
      const debtorId = id("dbt", ci * 10 + di + 1);
      const kind: DebtorProfile["kind"] =
        di === 9
          ? "NEW"
          : di === 8 && ci % 2 === 1
            ? "SLOW"
            : di === 2 && ci === 0
              ? "DRIFT"
              : di === 1 && ci === 3
                ? "CONCENTRATED"
                : "NORMAL";
      const base =
        kind === "SLOW"
          ? cp.termsDays + 45
          : kind === "DRIFT"
            ? 35
            : cp.termsDays + rng.int(-6, 10);
      profiles.push({
        id: debtorId,
        clientIndex: ci,
        baseDaysToPay: base,
        kind,
      });
      ds.debtors.push({
        id: debtorId,
        clientId,
        name,
        nzbn: syntheticNzbn(ci * 100 + di + (params.name === "dev" ? 1 : 501)),
        // New debtors are re-dated once their first batch is known.
        firstSeenDate: addDays(today, -rng.int(400, 900)),
        creditBand: rng.pick(["A", "B", "B", "C"]),
      });
    });
  });

  const clientById = (clientId: string) =>
    ds.clients.find((c) => c.id === clientId)!;
  const debtorRow = (debtorId: string) =>
    ds.debtors.find((d) => d.id === debtorId)!;
  const ledgerRow = (ledgerId: string) =>
    ds.ledgerEntries.find((l) => l.id === ledgerId)!;
  const allocatedTo = (ledgerId: string, before?: string) =>
    ds.receiptAllocations
      .filter((a) => a.ledgerEntryId === ledgerId)
      .filter(
        (a) =>
          before === undefined ||
          ds.bankTransactions.find((t) => t.id === a.bankTransactionId)!.date <
            before,
      )
      .reduce((sum, a) => sum + a.amountCents, 0);

  const addLedger = (
    clientId: string,
    debtorId: string,
    invoiceNumber: string,
    amountCents: number,
    issueDate: string,
  ): string => {
    const ledgerId = nextId("led");
    ds.ledgerEntries.push({
      id: ledgerId,
      clientId,
      invoiceNumber,
      debtorId,
      amountCents,
      issueDate,
      recordedDate: issueDate,
    });
    ds.ledgerStatusEvents.push({
      ledgerEntryId: ledgerId,
      status: "AUTHORISED",
      effectiveDate: issueDate,
    });
    return ledgerId;
  };

  const removeLedger = (ledgerId: string) => {
    ds.ledgerEntries = ds.ledgerEntries.filter((l) => l.id !== ledgerId);
    ds.ledgerStatusEvents = ds.ledgerStatusEvents.filter(
      (e) => e.ledgerEntryId !== ledgerId,
    );
  };

  /** Records a receipt. When it completes the invoice, also the payment and PAID status. */
  const recordReceipt = (
    ledgerId: string,
    paidDate: string,
    amountCents: number,
  ) => {
    const led = ledgerRow(ledgerId);
    const bankId = nextId("bnk");
    ds.bankTransactions.push({
      id: bankId,
      clientId: led.clientId,
      date: paidDate,
      amountCents,
      counterpartyName: debtorRow(led.debtorId).name,
      reference: led.invoiceNumber,
    });
    ds.receiptAllocations.push({
      bankTransactionId: bankId,
      ledgerEntryId: ledgerId,
      amountCents,
    });
    if (allocatedTo(ledgerId) >= led.amountCents) {
      ds.debtorPayments.push({
        id: nextId("pay"),
        debtorId: led.debtorId,
        ledgerEntryId: ledgerId,
        invoiceNumber: led.invoiceNumber,
        issueDate: led.issueDate,
        paidDate,
        amountCents: led.amountCents,
      });
      ds.ledgerStatusEvents.push({
        ledgerEntryId: ledgerId,
        status: "PAID",
        effectiveDate: paidDate,
      });
    }
  };

  // 12 months of paid history before the window, per established debtor.

  for (const prof of profiles) {
    if (prof.kind === "NEW") continue;
    const clientId = ds.clients[prof.clientIndex]!.id!;
    // The drifting debtor pays every ten days or so, which gives the drift
    // rule enough payments in both of its windows (SPEC 7).
    const step = prof.kind === "DRIFT" ? 10 : 30;
    const count = prof.kind === "DRIFT" ? 40 : 13;
    for (let m = count; m >= 1; m--) {
      const issue = addDays(
        today,
        -(m * step) - rng.int(0, step === 10 ? 3 : 10),
      );
      // The drifting debtor slows from about 35 to about 70 days to pay.
      const dtp =
        prof.kind === "DRIFT"
          ? daysBetween(issue, today) <= 190
            ? 70 + rng.int(-3, 3)
            : 35 + rng.int(-3, 3)
          : prof.baseDaysToPay + rng.int(-4, 4);
      const paid = addDays(issue, dtp);
      if (paid > today) continue;
      const number = `H-${prof.id.slice(-4)}-${pad(m, 2)}`;
      const amount = rng.amountCents(450_000, 60_000, 2_500_000);
      const ledgerId = addLedger(clientId, prof.id, number, amount, issue);
      recordReceipt(ledgerId, paid, amount);
    }
  }

  // Batches and invoices

  const working: WorkingInvoice[] = [];
  const reviewedCount = params.batches.length - params.pendingBatches;
  const batchNoForClient = new Map<number, number>();
  const submittedOf = (w: WorkingInvoice) =>
    ds.batches[w.batchIndex]!.submittedDate;

  params.batches.forEach((b, bi) => {
    const client = ds.clients[b.client]!;
    const batchId = id("bat", bi + 1);
    const submitted = addDays(today, -b.daysAgo);
    ds.batches.push({
      id: batchId,
      clientId: client.id,
      submittedDate: submitted,
      status: bi < reviewedCount ? "REVIEWED" : "PENDING",
    });
    const clientBatchNo = (batchNoForClient.get(b.client) ?? 0) + 1;
    batchNoForClient.set(b.client, clientBatchNo);

    const eligible = profiles.filter(
      (pr) =>
        pr.clientIndex === b.client &&
        // New debtors only appear from a client's second batch onward.
        (pr.kind !== "NEW" || clientBatchNo >= 2),
    );
    const normal = eligible.filter((e) => e.kind === "NORMAL");
    const count = rng.int(28, 34);
    // Debtors are dealt round-robin so no debtor dominates a batch by chance.
    const deck = rng.shuffle(normal);
    for (let k = 0; k < count; k++) {
      // Slow and new debtors appear rarely, keeping labels near the target rate.
      let prof = deck[k % deck.length]!;
      const rare = eligible.filter(
        (e) => e.kind === "SLOW" || e.kind === "NEW",
      );
      if (rare.length > 0 && rng.next() < 0.06) prof = rng.pick(rare);
      // Issued recently enough that a normal payer settles within 25 days of due.
      const issue = addDays(
        submitted,
        -rng.int(3, Math.min(40, 20 + client.paymentTermsDays)),
      );
      const amount = rng.amountCents(800_000, 80_000, 4_000_000, 0.4);
      const invoiceId = nextId("inv");
      const number = `INV-${b.client + 1}${invoiceId.slice(-4)}`;
      const ledgerId = addLedger(client.id!, prof.id, number, amount, issue);
      const problems = new Set<ProblemType>();
      if (prof.kind === "SLOW") problems.add("SLOW_PAYER");
      if (prof.kind === "NEW") problems.add("NEW_DEBTOR");
      working.push({
        row: {
          id: invoiceId,
          batchId,
          clientId: client.id!,
          debtorId: prof.id,
          invoiceNumber: number,
          issueDate: issue,
          dueDate: addDays(issue, client.paymentTermsDays),
          amountCents: amount,
          description: rng.pick([
            "Freight services",
            "Goods supplied",
            "Fabrication works",
            "Labour hire",
            "Consumables",
            "Project milestone",
          ]),
        },
        batchIndex: bi,
        ledgerId,
        problems,
        fundable: bi < reviewedCount,
      });
    }
  });

  // New debtors: first seen within 60 days of their first submission.
  for (const prof of profiles.filter((pr) => pr.kind === "NEW")) {
    const first = working
      .filter((w) => w.row.debtorId === prof.id)
      .map(submittedOf)
      .sort()[0];
    debtorRow(prof.id).firstSeenDate = addDays(
      first ?? today,
      -rng.int(10, 45),
    );
  }

  // Scripted concentration: one debtor's invoices dominate a reviewed batch.
  const concentrated = profiles.find((pr) => pr.kind === "CONCENTRATED");
  if (concentrated) {
    const batchIdx = params.batches.findIndex(
      (b, i) => b.client === concentrated.clientIndex && i < reviewedCount,
    );
    const inBatch = working.filter(
      (w) => w.batchIndex === batchIdx && w.problems.size === 0,
    );
    inBatch.slice(0, 6).forEach((w, k) => {
      // The offset keeps clamped amounts distinct, so they never look like DUPs.
      const amount =
        rng.amountCents(3_200_000, 2_500_000, 4_500_000) + k * 1_37;
      w.row.debtorId = concentrated.id;
      w.row.amountCents = amount;
      const led = ledgerRow(w.ledgerId!);
      led.debtorId = concentrated.id;
      led.amountCents = amount;
    });
  }

  // Invoice-level problems

  const applyProblem = (w: WorkingInvoice, pt: ProblemType): boolean => {
    const submitted = submittedOf(w);
    const terms = clientById(w.row.clientId).paymentTermsDays;
    switch (pt) {
      case "DUP": {
        // Resubmission of an invoice from an earlier batch of the same client.
        const earlier = working.filter(
          (o) =>
            o.row.clientId === w.row.clientId &&
            o.batchIndex < w.batchIndex &&
            o.problems.size === 0 &&
            o.ledgerId !== null &&
            o.row.debtorId !== concentrated?.id,
        );
        if (earlier.length === 0 || w.ledgerId === null) return false;
        const src = rng.pick(earlier);
        removeLedger(w.ledgerId);
        w.ledgerId = src.ledgerId;
        Object.assign(w.row, {
          debtorId: src.row.debtorId,
          invoiceNumber: src.row.invoiceNumber,
          issueDate: src.row.issueDate,
          dueDate: src.row.dueDate,
          amountCents: src.row.amountCents,
          description: src.row.description,
        });
        // The original's debtor may be slow or new; carry that label too.
        const srcProfile = profiles.find((pr) => pr.id === src.row.debtorId)!;
        if (srcProfile.kind === "SLOW") w.problems.add("SLOW_PAYER");
        if (srcProfile.kind === "NEW") w.problems.add("NEW_DEBTOR");
        return true;
      }
      case "LEDGER_MISSING":
        if (w.ledgerId === null) return false;
        removeLedger(w.ledgerId);
        w.ledgerId = null;
        return true;
      case "LEDGER_MISMATCH": {
        if (w.ledgerId === null) return false;
        ledgerRow(w.ledgerId).amountCents = Math.round(
          w.row.amountCents / (1 + rng.int(12, 40) / 100),
        );
        return true;
      }
      case "VOIDED": {
        if (w.ledgerId === null) return false;
        const voidDate = addDays(
          maxDate(w.row.issueDate, addDays(submitted, -20)),
          1,
        );
        if (voidDate >= submitted) return false;
        ds.ledgerStatusEvents.push({
          ledgerEntryId: w.ledgerId,
          status: "VOIDED",
          effectiveDate: voidDate,
        });
        return true;
      }
      case "CREDIT_NOTE": {
        if (w.ledgerId === null) return false;
        const share = rng.next() < 0.5 ? rng.int(5, 15) : rng.int(25, 60);
        const date = addDays(w.row.issueDate, rng.int(1, 3));
        if (date >= submitted) return false;
        ds.creditNotes.push({
          id: nextId("cn"),
          ledgerEntryId: w.ledgerId,
          date,
          amountCents: Math.round(
            (ledgerRow(w.ledgerId).amountCents * share) / 100,
          ),
        });
        return true;
      }
      case "ALREADY_PAID": {
        if (w.ledgerId === null) return false;
        const paid = addDays(submitted, -rng.int(1, 5));
        if (paid <= w.row.issueDate) return false;
        recordReceipt(w.ledgerId, paid, ledgerRow(w.ledgerId).amountCents);
        return true;
      }
      case "OVER_AGE": {
        if (w.ledgerId === null) return false;
        const issue = addDays(submitted, -rng.int(95, 130));
        w.row.issueDate = issue;
        w.row.dueDate = addDays(issue, terms);
        const led = ledgerRow(w.ledgerId);
        led.issueDate = issue;
        led.recordedDate = issue;
        for (const e of ds.ledgerStatusEvents) {
          if (e.ledgerEntryId === led.id && e.status === "AUTHORISED") {
            e.effectiveDate = issue;
          }
        }
        return true;
      }
      case "FUTURE_DATED": {
        if (w.ledgerId === null) return false;
        const issue = addDays(submitted, rng.int(2, 15));
        const recorded = addDays(submitted, -1);
        w.row.issueDate = issue;
        w.row.dueDate = addDays(issue, terms);
        // The client's ledger already holds the invoice, with the future date.
        const led = ledgerRow(w.ledgerId);
        led.issueDate = issue;
        led.recordedDate = recorded;
        for (const e of ds.ledgerStatusEvents) {
          if (e.ledgerEntryId === led.id && e.status === "AUTHORISED") {
            e.effectiveDate = recorded;
          }
        }
        return true;
      }
      default:
        return false;
    }
  };

  // Debtor-level labels and the scripted concentration invoices count toward
  // the target rate, so they come out of the injection budget.
  const debtorLabelled = working.filter((w) => w.problems.size > 0).length;
  const concentratedCount = working.filter(
    (w) => w.row.debtorId === concentrated?.id,
  ).length;
  const target = Math.round(working.length * params.problemRate);
  const injections = Math.max(
    target - debtorLabelled - concentratedCount,
    // At least two positives per injectable check, so every check is measurable.
    2 * INJECTABLE.length + 2,
  );
  const candidates = rng.shuffle(
    working.filter(
      (w) => w.problems.size === 0 && w.row.debtorId !== concentrated?.id,
    ),
  );

  let made = 0;
  for (const w of candidates) {
    if (made >= injections) break;
    // Two combined cases first, then cycle through the single problem types.
    const combo: ProblemType[] =
      made === 0
        ? ["CREDIT_NOTE", "LEDGER_MISMATCH"]
        : made === 1
          ? ["OVER_AGE", "VOIDED"]
          : [INJECTABLE[made % INJECTABLE.length]!];
    if (!combo.every((pt) => applyProblem(w, pt))) continue;
    for (const pt of combo) w.problems.add(pt);
    w.fundable = false;
    made++;
  }

  // Tricky clean cases

  const cleanPool = rng.shuffle(
    working.filter(
      (w) =>
        w.problems.size === 0 &&
        w.fundable &&
        w.ledgerId !== null &&
        w.row.debtorId !== concentrated?.id,
    ),
  );

  // 1. A legitimate 40% part-payment before submission: must not read as paid.
  const partial = cleanPool[0];
  if (partial?.ledgerId) {
    const led = ledgerRow(partial.ledgerId);
    const paid = addDays(submittedOf(partial), -2);
    if (paid > led.issueDate) {
      recordReceipt(led.id!, paid, Math.round(led.amountCents * 0.4));
      ds.cleanCases[partial.row.id] = "PARTIAL_PAYMENT";
    }
  }

  // 2. A reissued invoice: the original was voided and replaced with a new number.
  const original = cleanPool.find(
    (w) =>
      w !== partial &&
      working.some(
        (o) => o.row.clientId === w.row.clientId && o.batchIndex > w.batchIndex,
      ),
  );
  if (original?.ledgerId) {
    const laterBatch = working.find(
      (o) =>
        o.row.clientId === original.row.clientId &&
        o.batchIndex > original.batchIndex,
    )!.batchIndex;
    const laterSubmitted = ds.batches[laterBatch]!.submittedDate;
    const issue = addDays(original.row.issueDate, 3);
    if (daysBetween(issue, laterSubmitted) <= 90) {
      original.fundable = false; // held at review, then voided and reissued
      const voidDate = addDays(laterSubmitted, -10);
      ds.ledgerStatusEvents.push({
        ledgerEntryId: original.ledgerId,
        status: "VOIDED",
        effectiveDate: voidDate,
      });
      const invoiceId = nextId("inv");
      const number = `INV-R${invoiceId.slice(-4)}`;
      const newLedger = addLedger(
        original.row.clientId,
        original.row.debtorId,
        number,
        original.row.amountCents,
        issue,
      );
      const led = ledgerRow(newLedger);
      led.recordedDate = maxDate(issue, voidDate);
      led.supersedesLedgerEntryId = original.ledgerId;
      for (const e of ds.ledgerStatusEvents) {
        if (e.ledgerEntryId === newLedger) e.effectiveDate = led.recordedDate;
      }
      working.push({
        row: {
          ...original.row,
          id: invoiceId,
          batchId: ds.batches[laterBatch]!.id!,
          invoiceNumber: number,
          issueDate: issue,
          dueDate: addDays(
            issue,
            clientById(original.row.clientId).paymentTermsDays,
          ),
        },
        batchIndex: laterBatch,
        ledgerId: newLedger,
        problems: new Set(),
        fundable: laterBatch < reviewedCount,
      });
      ds.cleanCases[invoiceId] = "REISSUED";
    }
  }

  // Fundings: clean invoices in reviewed batches are funded the day after
  // submission. Collection happens when the debtor pays.

  working.sort(
    (a, b) => a.batchIndex - b.batchIndex || (a.row.id < b.row.id ? -1 : 1),
  );
  const exposures = new Map<string, Exposure>();
  const invoiceByFunding = new Map<string, WorkingInvoice>();
  for (const w of working) {
    if (!w.fundable || w.ledgerId === null) continue;
    const submitted = submittedOf(w);
    const client = clientById(w.row.clientId);
    const prof = profiles.find((pr) => pr.id === w.row.debtorId)!;
    const fundingId = nextId("fnd");
    const funded = addDays(submitted, 1);
    ds.fundings.push({
      id: fundingId,
      invoiceId: w.row.id,
      fundedDate: funded,
      advanceCents: Math.floor(
        (w.row.amountCents * client.advanceRateBps!) / 10_000,
      ),
    });
    const dtp =
      prof.kind === "DRIFT"
        ? 70 + rng.int(-3, 3)
        : prof.baseDaysToPay + rng.int(-4, 6);
    // Paid after funding, and for normal payers no later than 25 days past due.
    const earliest = addDays(submitted, rng.int(5, 20));
    const byDtp = addDays(w.row.issueDate, dtp);
    const paid =
      prof.kind === "DRIFT"
        ? maxDate(byDtp, earliest)
        : maxDate(
            minDate(maxDate(byDtp, earliest), addDays(w.row.dueDate, 25)),
            addDays(submitted, 5),
          );
    exposures.set(fundingId, {
      debtorId: w.row.debtorId,
      clientId: w.row.clientId,
      face: w.row.amountCents,
      funded,
      collected: paid <= today ? paid : null,
    });
    invoiceByFunding.set(fundingId, w);
  }

  // Scripted: two funded invoices are never paid and go over 30 days overdue.
  const overdue = ds.fundings
    .filter((f) => {
      const w = invoiceByFunding.get(f.id!)!;
      const kind = profiles.find((pr) => pr.id === w.row.debtorId)!.kind;
      return (
        kind === "NORMAL" && addDays(w.row.dueDate, 31) <= addDays(today, -5)
      );
    })
    .slice(0, 2);
  for (const f of overdue) {
    exposures.get(f.id!)!.collected = null;
    const w = invoiceByFunding.get(f.id!)!;
    const from = addDays(w.row.dueDate, 31);
    ds.scriptedEvents.push({
      kind: "OVERDUE_FUNDED",
      date: from,
      description: `Funded invoice ${w.row.invoiceNumber} unpaid more than 30 days after its due date`,
    });
  }

  // Scripted: a credit note lands on a funded, still outstanding invoice.
  const cnTarget = ds.fundings.find((f) => {
    const e = exposures.get(f.id!)!;
    return (
      !overdue.includes(f) &&
      e.collected === null &&
      daysBetween(e.funded, today) >= 15
    );
  });
  if (cnTarget) {
    const w = invoiceByFunding.get(cnTarget.id!)!;
    const date = addDays(today, -12);
    ds.creditNotes.push({
      id: nextId("cn"),
      ledgerEntryId: w.ledgerId!,
      date,
      amountCents: Math.round(w.row.amountCents * 0.3),
    });
    ds.scriptedEvents.push({
      kind: "FUNDED_CREDIT_NOTE",
      date,
      description: `Credit note for 30% of funded invoice ${w.row.invoiceNumber}`,
    });
  }

  // Collections: receipt for the remaining balance and a COLLECTION adjustment.
  for (const f of ds.fundings) {
    const e = exposures.get(f.id!)!;
    if (e.collected === null) continue;
    const w = invoiceByFunding.get(f.id!)!;
    const led = ledgerRow(w.ledgerId!);
    const remaining = led.amountCents - allocatedTo(led.id!);
    if (remaining > 0) recordReceipt(led.id!, e.collected, remaining);
    ds.fundingAdjustments.push({
      id: nextId("adj"),
      fundingId: f.id!,
      date: e.collected,
      kind: "COLLECTION",
      amountCents: f.advanceCents,
    });
  }

  // Scripted: the drifting debtor's recent payments run about 35 days slower.
  const drift = profiles.find((pr) => pr.kind === "DRIFT");
  if (drift) {
    ds.scriptedEvents.push({
      kind: "PAYMENT_DRIFT",
      date: addDays(today, -60),
      description: `Debtor ${debtorRow(drift.id).name} slows from about 35 to about 70 days to pay`,
    });
  }

  ds.invoices = [...working]
    .sort((a, b) => (a.row.id < b.row.id ? -1 : 1))
    .map((w) => w.row);
  ds.labels = ds.invoices.map((row) => ({
    invoiceId: row.id!,
    expectedCheckIds: [
      ...working.find((w) => w.row.id === row.id)!.problems,
    ].sort(),
  }));
  return applyReferenceLabels(ds, {
    driftDebtorId: drift?.id ?? null,
    concentratedDebtorId: concentrated?.id ?? null,
  });
}
