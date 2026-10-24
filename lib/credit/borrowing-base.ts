/**
 * Versioned, pure borrowing-base calculation for review with a credit SME.
 * Input rows are an independently reconciled as-of snapshot; this module
 * neither reads a database nor authorizes a drawdown. No LLM is used.
 *
 * The concentration cap is a fraction of the eligible pool BEFORE
 * concentration. It is applied deterministically by invoice ID within each
 * debtor. This convention must be agreed in the facility's policy.
 */

export interface Receivable {
  invoiceId: string;
  debtorId: string;
  faceCents: number;
  receivedCents: number;
  creditNoteCents: number;
  ineligibleReasons: string[];
}

export interface BorrowingPolicy {
  version: string;
  advanceRateBps: number;
  maximumDebtorShareBps: number;
  facilityLimitCents: number;
  drawnCents: number;
  reservesCents: number;
  /** Optional aggregate availability cap, applied after reserves. */
  sublimitCents?: number;
}

export interface ReceivableTreatment {
  invoiceId: string;
  debtorId: string;
  faceCents: number;
  netCents: number;
  excludedCents: number;
  concentrationExcessCents: number;
  eligibleCents: number;
  advanceCents: number;
  reasons: string[];
}

export interface BorrowingBaseReport {
  asOfDate: string;
  policyVersion: string;
  grossReceivablesCents: number;
  receiptsAndCreditsCents: number;
  netReceivablesCents: number;
  excludedCents: number;
  concentrationExcessCents: number;
  eligibleCollateralCents: number;
  grossAdvanceCents: number;
  reservesCents: number;
  securedAdvanceCents: number;
  facilityHeadroomCents: number;
  sublimitHeadroomCents: number | null;
  availableCents: number;
  overdrawnCents: number;
  treatments: ReceivableTreatment[];
}

function cents(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer of NZD cents`);
  }
}

function bps(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${field} must be between 0 and 10000 basis points`);
  }
}

function checkedSum(values: number[], field: string): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) throw new Error(`${field} overflow`);
  return total;
}

function advance(centsValue: number, rateBps: number): number {
  // Split into whole and remainder units before multiplication to avoid
  // unsafe intermediate precision on large but otherwise safe integers.
  const whole = Math.floor(centsValue / 10_000);
  const rest = centsValue % 10_000;
  const result = whole * rateBps + Math.floor((rest * rateBps) / 10_000);
  if (!Number.isSafeInteger(result)) throw new Error("advance overflow");
  return result;
}

/** Throws on missing or inconsistent inputs rather than calculating false availability. */
export function borrowingBase(
  asOfDate: string,
  policy: BorrowingPolicy,
  receivables: Receivable[],
): BorrowingBaseReport {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate) ||
    new Date(`${asOfDate}T00:00:00Z`).toISOString().slice(0, 10) !== asOfDate
  ) {
    throw new Error("asOfDate must be a real YYYY-MM-DD business date");
  }
  if (!policy.version.trim()) throw new Error("Policy version required");
  bps(policy.advanceRateBps, "advanceRateBps");
  bps(policy.maximumDebtorShareBps, "maximumDebtorShareBps");
  cents(policy.facilityLimitCents, "facilityLimitCents");
  cents(policy.drawnCents, "drawnCents");
  cents(policy.reservesCents, "reservesCents");
  if (policy.sublimitCents !== undefined) cents(policy.sublimitCents, "sublimitCents");

  const ids = new Set<string>();
  const rows: ReceivableTreatment[] = [...receivables]
    .sort((a, b) => a.invoiceId.localeCompare(b.invoiceId))
    .map((r) => {
      if (!r.invoiceId.trim() || !r.debtorId.trim()) throw new Error("Invoice and debtor IDs required");
      if (ids.has(r.invoiceId)) throw new Error(`Duplicate invoice ${r.invoiceId}`);
      ids.add(r.invoiceId);
      cents(r.faceCents, `${r.invoiceId} faceCents`);
      cents(r.receivedCents, `${r.invoiceId} receivedCents`);
      cents(r.creditNoteCents, `${r.invoiceId} creditNoteCents`);
      if (!Array.isArray(r.ineligibleReasons) || r.ineligibleReasons.some((v) => typeof v !== "string" || !v.trim())) {
        throw new Error(`${r.invoiceId} requires an explicit eligibility assessment`);
      }
      const deductions = checkedSum([r.receivedCents, r.creditNoteCents], "receipts and credits");
      if (deductions > r.faceCents) throw new Error(`${r.invoiceId} deductions exceed face`);
      const netCents = r.faceCents - deductions;
      const excludedCents = r.ineligibleReasons.length > 0 ? netCents : 0;
      return {
        invoiceId: r.invoiceId,
        debtorId: r.debtorId,
        faceCents: r.faceCents,
        netCents,
        excludedCents,
        concentrationExcessCents: 0,
        eligibleCents: netCents - excludedCents,
        advanceCents: 0,
        reasons: [...new Set(r.ineligibleReasons)],
      };
    });

  const grossReceivablesCents = checkedSum(rows.map((r) => r.faceCents), "gross receivables");
  const netReceivablesCents = checkedSum(rows.map((r) => r.netCents), "net receivables");
  const excludedCents = checkedSum(rows.map((r) => r.excludedCents), "exclusions");
  const eligibleBeforeConcentration = netReceivablesCents - excludedCents;
  const debtorCap = advance(eligibleBeforeConcentration, policy.maximumDebtorShareBps);

  // Stable invoice ordering produces stable per-invoice explanations.
  const usedByDebtor = new Map<string, number>();
  for (const row of rows) {
    const used = usedByDebtor.get(row.debtorId) ?? 0;
    const kept = Math.min(row.eligibleCents, Math.max(0, debtorCap - used));
    row.concentrationExcessCents = row.eligibleCents - kept;
    row.eligibleCents = kept;
    if (row.concentrationExcessCents > 0) row.reasons.push("CONCENTRATION_CAP");
    row.advanceCents = advance(kept, policy.advanceRateBps);
    usedByDebtor.set(row.debtorId, used + kept);
  }

  const concentrationExcessCents = checkedSum(rows.map((r) => r.concentrationExcessCents), "concentration");
  const eligibleCollateralCents = checkedSum(rows.map((r) => r.eligibleCents), "eligible collateral");
  const grossAdvanceCents = checkedSum(rows.map((r) => r.advanceCents), "gross advances");
  const securedAdvanceCents = Math.max(0, grossAdvanceCents - policy.reservesCents);
  const facilityHeadroomCents = Math.max(0, policy.facilityLimitCents - policy.drawnCents);
  const sublimitHeadroomCents =
    policy.sublimitCents === undefined
      ? null
      : Math.max(0, policy.sublimitCents - policy.drawnCents);
  const availableCents = Math.max(
    0,
    Math.min(
      Math.max(0, securedAdvanceCents - policy.drawnCents),
      facilityHeadroomCents,
      sublimitHeadroomCents ?? Number.MAX_SAFE_INTEGER,
    ),
  );

  return {
    asOfDate,
    policyVersion: policy.version,
    grossReceivablesCents,
    receiptsAndCreditsCents: grossReceivablesCents - netReceivablesCents,
    netReceivablesCents,
    excludedCents,
    concentrationExcessCents,
    eligibleCollateralCents,
    grossAdvanceCents,
    reservesCents: policy.reservesCents,
    securedAdvanceCents,
    facilityHeadroomCents,
    sublimitHeadroomCents,
    availableCents,
    overdrawnCents: Math.max(0, policy.drawnCents - securedAdvanceCents),
    treatments: rows,
  };
}
