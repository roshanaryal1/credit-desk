// Money rules from SPEC 4.3, as pure functions over plain rows.

export function advanceCents(
  amountCents: number,
  advanceRateBps: number,
): number {
  return Math.floor((amountCents * advanceRateBps) / 10_000);
}

export interface FundableInput {
  approvedAmountsCents: number[];
  advanceRateBps: number;
  facilityLimitCents: number;
  fundsInUseCents: number;
}

/** Advances on approved invoices, rounded per invoice, capped by facility headroom. */
export function fundableCents(input: FundableInput): {
  uncapped: number;
  capped: number;
  headroom: number;
} {
  const uncapped = input.approvedAmountsCents.reduce(
    (sum, a) => sum + advanceCents(a, input.advanceRateBps),
    0,
  );
  const headroom = Math.max(
    0,
    input.facilityLimitCents - input.fundsInUseCents,
  );
  return { uncapped, capped: Math.min(uncapped, headroom), headroom };
}
