import { sha256 } from "@/lib/trust/canonical";

export const AGEING_BUCKETS = [
  "CURRENT",
  "DAYS_1_30",
  "DAYS_31_60",
  "DAYS_61_90",
  "DAYS_90_PLUS",
] as const;

export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

export interface PortfolioClientSnapshot {
  id: string;
  name: string;
  facilityLimitCents: number;
  fundedPrincipalCents: number;
  commitmentHeadroomCents: number;
  receivableOutstandingCents: number | null;
  buckets: Record<AgeingBucket, number> | null;
  receiptsLast30DaysCents: number | null;
  receiptsPrevious30DaysCents: number | null;
  creditsLast30DaysCents: number | null;
  invoiceIds: string[];
  unresolvedIncidents: Array<{
    id: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    firstDetectedDate: string;
  }>;
  sourceExceptions: string[];
}

export interface PortfolioReviewPack {
  asOf: string;
  configVersion: string;
  selectedClientId: string | null;
  clients: PortfolioClientSnapshot[];
}

function text(value: string): string {
  // Both Markdown injection and line-oriented formula prefixes are escaped.
  // Export is Markdown only, never interpreted as HTML or an XLSX formula.
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/([\x60*_{}\[\]()#+.!|<>])/g, "\\$1")
    .replace(/^([=+@-])/, "\\$1");
}

function cents(value: number): string {
  if (!Number.isSafeInteger(value)) throw new Error("Invalid NZD cents");
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}NZ$${Math.floor(abs / 100).toLocaleString("en-NZ")}.${String(abs % 100).padStart(2, "0")}`;
}

function total(values: number[]): number {
  const amount = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(amount))
    throw new Error("Portfolio total overflow");
  return amount;
}

function amountOrUnknown(value: number | null): string {
  return value === null
    ? "Unknown — incomplete synthetic source"
    : cents(value);
}

function clientLink(clientId: string): string {
  return `/clients/${encodeURIComponent(clientId)}`;
}

/** Deterministic Markdown. No wall-clock timestamp, network, agent or writes. */
export function renderPortfolioReviewPack(input: PortfolioReviewPack) {
  const clients = [...input.clients].sort((a, b) => a.id.localeCompare(b.id));
  const funded = total(clients.map((c) => c.fundedPrincipalCents));
  const headroom = total(clients.map((c) => c.commitmentHeadroomCents));
  const fullAgeing =
    clients.length > 0 &&
    clients.every((c) => c.receivableOutstandingCents !== null);
  const receivables = fullAgeing
    ? total(clients.map((c) => c.receivableOutstandingCents ?? 0))
    : null;
  const high = clients
    .flatMap((c) => c.unresolvedIncidents)
    .filter((incident) => incident.severity === "HIGH").length;
  const incidentCount = clients.reduce(
    (sum, c) => sum + c.unresolvedIncidents.length,
    0,
  );
  const lines = [
    "# Credit Desk — synthetic portfolio review pack",
    "",
    "**FICTIONAL DATA / REVIEW ONLY / NOT AN APPROVAL OR DRAWABLE FUNDING CALCULATION**",
    "",
    `- Business date (Pacific/Auckland): ${input.asOf}`,
    `- Source classification: SYNTHETIC_FIXTURES; real bank/accounting feeds not verified`,
    `- Check configuration: ${text(input.configVersion)}`,
    `- Scope: ${input.selectedClientId ? `Client ${text(input.selectedClientId)}` : "Entire synthetic portfolio"}`,
    `- Client count: ${clients.length}`,
    "",
    "## Portfolio position (NZD)",
    "",
    `- Funded principal outstanding: ${cents(funded)}`,
    `- Commitment headroom: ${cents(headroom)} (NOT drawable availability)`,
    `- Ledger receivables outstanding: ${amountOrUnknown(receivables)} (different from funded principal)`,
    `- Unresolved incidents: ${incidentCount}, including ${high} high-severity`,
    "",
    "The aggregate receivables figure is withheld if any selected client has no source-backed ledger records. Facility terms are current demo terms, not historical signed contracts. DSO and real provider freshness cannot be verified.",
    "",
    "## Client records and supporting evidence",
    "",
  ];

  for (const c of clients) {
    lines.push(
      `### ${text(c.name)} (${text(c.id)})`,
      "",
      `- Client record: [${text(c.id)}](${clientLink(c.id)})`,
      `- Commitment: ${cents(c.facilityLimitCents)}`,
      `- Funded principal: ${cents(c.fundedPrincipalCents)}`,
      `- Commitment headroom: ${cents(c.commitmentHeadroomCents)} (not drawable)`,
      `- Ledger receivables: ${amountOrUnknown(c.receivableOutstandingCents)}`,
    );
    if (c.buckets) {
      lines.push(
        "- Receivables ageing (current, 1–30, 31–60, 61–90, 90+ days): " +
          AGEING_BUCKETS.map((bucket) => cents(c.buckets![bucket])).join(" / "),
      );
    } else {
      lines.push("- Receivables ageing: Unknown — no dated ledger records");
    }
    lines.push(
      `- Receipts last 30 days: ${amountOrUnknown(c.receiptsLast30DaysCents)}`,
      `- Receipts previous 30 days: ${amountOrUnknown(c.receiptsPrevious30DaysCents)}`,
      `- Credits last 30 days: ${amountOrUnknown(c.creditsLast30DaysCents)}`,
      "",
      "### Unresolved risk exceptions",
      "",
    );
    if (!c.unresolvedIncidents.length) {
      lines.push("None recorded in the selected synthetic period.");
    } else {
      for (const incident of [...c.unresolvedIncidents].sort((a, b) =>
        a.id.localeCompare(b.id),
      )) {
        lines.push(
          `- ${text(incident.id)}: ${incident.severity}, first detected ${incident.firstDetectedDate}; [review incident](/watch?asOf=${input.asOf}&incident=${encodeURIComponent(incident.id)})`,
        );
      }
    }
    lines.push("", "### Source evidence", "");
    if (!c.invoiceIds.length)
      lines.push("No dated ledger invoice IDs available.");
    for (const id of [...new Set(c.invoiceIds)].sort()) {
      lines.push(
        `- Ledger invoice: ${text(id)}; [client collections](${clientLink(c.id)}/collections)`,
      );
    }
    lines.push("", "### Source exceptions", "");
    for (const exception of c.sourceExceptions) {
      lines.push(`- ${text(exception)}`);
    }
    lines.push("");
  }
  if (!clients.length) {
    lines.push(
      "No synthetic client records match this scope. No balances or incidents were inferred.",
      "",
    );
  }
  lines.push(
    "## Interpretation",
    "",
    "All figures refer to dated fictional inputs. Receivable balances, funded principal and unused facility commitment are distinct quantities and must never be added into a funding approval total. No live connection, verified identity, settlement, lender policy approval, model-generated financial figure or human signature is represented.",
    "",
  );
  const body = lines.join("\n");
  const digest = sha256(body);
  return {
    digest,
    markdown: `${body}SHA-256 of the preceding Markdown body: ${digest}\n`,
  };
}
