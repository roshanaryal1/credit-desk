import { z } from "zod";

import {
  borrowingBase,
  type BorrowingBaseReport,
  type BorrowingPolicy,
  type Receivable,
} from "./borrowing-base";

// Strings at the HTTP boundary prevent blank, fractional, negative,
// scientific-notation and unsafe-integer coercion.
const integerString = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, "Enter a whole non-negative number")
  .transform(Number)
  .pipe(z.number().int().safe().nonnegative());
const bpsString = integerString.pipe(z.number().max(10_000));

export const ScenarioInputSchema = z
  .object({
    advanceRateBps: bpsString,
    maximumDebtorShareBps: bpsString,
    reservesCents: integerString,
    facilityLimitCents: integerString,
  })
  .strict();

export type ScenarioInputs = z.infer<typeof ScenarioInputSchema>;

export const SCENARIO_KEYS = [
  "advanceRateBps",
  "maximumDebtorShareBps",
  "reservesCents",
  "facilityLimitCents",
] as const;

export type ScenarioKey = (typeof SCENARIO_KEYS)[number];

export function parseScenarioParams(
  query: Record<string, string | string[] | undefined>,
) {
  // A missing parameter is an unmodified baseline. Supplying only some
  // parameters is an error instead of silently fabricating omitted policy.
  const requested = SCENARIO_KEYS.some((key) => query[key] !== undefined);
  if (!requested) return { requested: false as const, valid: true as const };
  const values: Record<string, unknown> = {};
  for (const key of SCENARIO_KEYS) values[key] = query[key];
  const result = ScenarioInputSchema.safeParse(values);
  if (!result.success) {
    return {
      requested: true as const,
      valid: false as const,
      errors: result.error.issues.map((issue) => ({
        field: String(issue.path[0] ?? "scenario"),
        message: issue.message,
      })),
    };
  }
  return {
    requested: true as const,
    valid: true as const,
    values: result.data,
  };
}

export const WATERFALL_FIELDS = [
  "grossReceivablesCents",
  "receiptsAndCreditsCents",
  "netReceivablesCents",
  "excludedCents",
  "concentrationExcessCents",
  "eligibleCollateralCents",
  "grossAdvanceCents",
  "reservesCents",
  "securedAdvanceCents",
  "facilityHeadroomCents",
  "availableCents",
  "overdrawnCents",
] as const satisfies readonly (keyof BorrowingBaseReport)[];

export function compareScenario(
  asOf: string,
  baselinePolicy: BorrowingPolicy,
  receivables: readonly Receivable[],
  input: ScenarioInputs,
) {
  // Re-run the SAME pure kernel on the SAME dated invoice rows.
  // The contractual drawn balance and eligibility assessments never change.
  const counterfactualPolicy: BorrowingPolicy = {
    ...baselinePolicy,
    ...input,
    version: baselinePolicy.version + "/COUNTERFACTUAL",
  };
  const baseline = borrowingBase(asOf, baselinePolicy, [...receivables]);
  const counterfactual = borrowingBase(asOf, counterfactualPolicy, [
    ...receivables,
  ]);
  const waterfall = WATERFALL_FIELDS.map((field) => ({
    field,
    baselineCents: baseline[field],
    scenarioCents: counterfactual[field],
    deltaCents: counterfactual[field] - baseline[field],
  }));
  const byInvoice = new Map(
    counterfactual.treatments.map((row) => [row.invoiceId, row]),
  );
  const invoices = baseline.treatments.map((original) => {
    const changed = byInvoice.get(original.invoiceId);
    if (!changed || changed.debtorId !== original.debtorId) {
      throw new Error("Scenario does not reconcile to baseline source IDs");
    }
    if (
      original.faceCents !== changed.faceCents ||
      original.netCents !== changed.netCents ||
      original.excludedCents !== changed.excludedCents
    ) {
      throw new Error(
        "Scenario changed source facts or eligibility exclusions",
      );
    }
    return {
      invoiceId: original.invoiceId,
      debtorId: original.debtorId,
      baselineAdvanceCents: original.advanceCents,
      scenarioAdvanceCents: changed.advanceCents,
      advanceDeltaCents: changed.advanceCents - original.advanceCents,
      baselineConcentrationCents: original.concentrationExcessCents,
      scenarioConcentrationCents: changed.concentrationExcessCents,
      concentrationDeltaCents:
        changed.concentrationExcessCents - original.concentrationExcessCents,
      exclusionReasons: original.reasons.filter(
        (reason) => reason !== "CONCENTRATION_CAP",
      ),
    };
  });
  const sum = (values: number[]) => {
    const result = values.reduce((a, b) => a + b, 0);
    if (!Number.isSafeInteger(result))
      throw new Error("Scenario delta overflow");
    return result;
  };
  if (
    sum(invoices.map((i) => i.advanceDeltaCents)) !==
      counterfactual.grossAdvanceCents - baseline.grossAdvanceCents ||
    sum(invoices.map((i) => i.concentrationDeltaCents)) !==
      counterfactual.concentrationExcessCents -
        baseline.concentrationExcessCents
  ) {
    throw new Error("Scenario invoice and aggregate deltas disagree");
  }
  return {
    baseline,
    counterfactual,
    counterfactualPolicy,
    waterfall,
    invoices,
  };
}
