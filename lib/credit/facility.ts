/** Principal-only synthetic lending facility models; no payments or interest. */
export type FacilityProduct = "REVOLVING" | "TERM";
export interface FacilityTerms {
  id: string;
  product: FacilityProduct;
  limitCents: number;
  startDate: string;
  maturityDate: string;
}
export interface PrincipalMovement {
  id: string;
  effectiveDate: string;
  action: "DRAW" | "REPAY";
  amountCents: number;
}
export interface PrincipalPosition {
  asOfDate: string;
  facilityId: string;
  product: FacilityProduct;
  outstandingCents: number;
  lifetimeDrawnCents: number;
  lifetimeRepaidCents: number;
  remainingCommitmentCents: number;
  drawableHeadroomCents: number;
  appliedMovementIds: string[];
}

function day(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid business date");
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value)
    throw new Error("Invalid business date");
  return Math.floor(ms / 86_400_000);
}
function cents(n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid integer cents");
}
function checked(n: number): number {
  if (!Number.isSafeInteger(n)) throw new Error("Monetary overflow");
  return n;
}

/**
 * Replays contractual principal movements. Does not authorize any drawdown.
 * A term facility cannot recycle a repaid amount; a revolving line can.
 */
export function principalPosition(
  terms: FacilityTerms, movements: PrincipalMovement[], asOfDate: string,
): PrincipalPosition {
  const asOf = day(asOfDate);
  const start = day(terms.startDate), maturity = day(terms.maturityDate);
  if (!terms.id.trim() || maturity < start || !["REVOLVING","TERM"].includes(terms.product))
    throw new Error("Invalid facility terms");
  cents(terms.limitCents);
  const ids = new Set<string>();
  const ordered = [...movements].sort((a,b) =>
    a.effectiveDate.localeCompare(b.effectiveDate) || a.id.localeCompare(b.id));
  for (const event of ordered) {
    if (!event.id.trim() || ids.has(event.id)) throw new Error("Duplicate/invalid event ID");
    ids.add(event.id);
    cents(event.amountCents);
    if (event.amountCents === 0) throw new Error("Zero-value movements are not allowed");
    if (!["DRAW","REPAY"].includes(event.action)) throw new Error("Invalid principal action");
    const at = day(event.effectiveDate);
    if (at < start) throw new Error("Movement before facility start");
    if (event.action === "DRAW" && at > maturity) throw new Error("Draw after facility maturity");
  }
  let outstanding = 0, lifetimeDrawn = 0, lifetimeRepaid = 0;
  const appliedMovementIds: string[] = [];
  for (const event of ordered) {
    if (day(event.effectiveDate) > asOf) break;
    if (event.action === "DRAW") {
      const allowed = terms.product === "TERM"
        ? checked(lifetimeDrawn + event.amountCents) <= terms.limitCents
        : checked(outstanding + event.amountCents) <= terms.limitCents;
      if (!allowed) throw new Error("Draw exceeds facility capacity");
      lifetimeDrawn = checked(lifetimeDrawn + event.amountCents);
      outstanding = checked(outstanding + event.amountCents);
    } else {
      if (event.amountCents > outstanding) throw new Error("Repayment exceeds principal outstanding");
      outstanding -= event.amountCents;
      lifetimeRepaid = checked(lifetimeRepaid + event.amountCents);
    }
    appliedMovementIds.push(event.id);
  }
  const remainingCommitmentCents = Math.max(0, terms.limitCents - (
    terms.product === "TERM" ? lifetimeDrawn : outstanding
  ));
  return {
    asOfDate, facilityId:terms.id, product:terms.product,
    outstandingCents:outstanding, lifetimeDrawnCents:lifetimeDrawn,
    lifetimeRepaidCents:lifetimeRepaid, remainingCommitmentCents,
    drawableHeadroomCents: asOf < start || asOf > maturity ? 0 : remainingCommitmentCents,
    appliedMovementIds,
  };
}
