import { describe, expect, it } from "vitest";

import {
  compareScenario,
  parseScenarioParams,
  ScenarioInputSchema,
} from "@/lib/credit/scenario-comparison";
import type { BorrowingPolicy, Receivable } from "@/lib/credit/borrowing-base";
import { createMemoryDb } from "@/lib/db/client";
import { DEMO_TODAY } from "@/lib/demo";
import { clientBorrowingReview } from "@/lib/queries/client-borrowing-review";
import { DEV_PARAMS, generate } from "@/lib/seed/generate";
import { writeDataset } from "@/lib/seed/write";

const policy: BorrowingPolicy = {
  version: "ILLUSTRATIVE-NOT-APPROVED",
  advanceRateBps: 8000,
  maximumDebtorShareBps: 10000,
  facilityLimitCents: 20000,
  drawnCents: 0,
  reservesCents: 0,
};

const invoices: Receivable[] = [
  {
    invoiceId: "ledger-1",
    debtorId: "debtor-a",
    faceCents: 10000,
    receivedCents: 0,
    creditNoteCents: 0,
    ineligibleReasons: [],
  },
  {
    invoiceId: "ledger-2",
    debtorId: "debtor-b",
    faceCents: 10000,
    receivedCents: 0,
    creditNoteCents: 0,
    ineligibleReasons: [],
  },
];

const inputs = {
  advanceRateBps: 8000,
  maximumDebtorShareBps: 10000,
  facilityLimitCents: 20000,
  reservesCents: 0,
};

describe("client counterfactual borrowing-base comparison (#161)", () => {
  it("rejects incomplete, fractional, negative, oversized and duplicated inputs", () => {
    expect(parseScenarioParams({})).toMatchObject({
      requested: false,
      valid: true,
    });
    expect(parseScenarioParams({ advanceRateBps: "8000" })).toMatchObject({
      requested: true,
      valid: false,
    });
    for (const value of ["", "-1", "1.2", "1e3", "01", "10001"]) {
      expect(
        ScenarioInputSchema.safeParse({
          ...Object.fromEntries(
            Object.entries(inputs).map(([key, n]) => [key, String(n)]),
          ),
          advanceRateBps: value,
        }).success,
      ).toBe(false);
    }
    for (const value of ["-1", "1.2", "9007199254740992", "1e4"]) {
      expect(
        ScenarioInputSchema.safeParse({
          advanceRateBps: "8000",
          maximumDebtorShareBps: "10000",
          facilityLimitCents: "20000",
          reservesCents: value,
        }).success,
      ).toBe(false);
    }
    expect(
      parseScenarioParams({
        advanceRateBps: ["7000", "8000"],
        maximumDebtorShareBps: "5000",
        facilityLimitCents: "20000",
        reservesCents: "0",
      }).valid,
    ).toBe(false);
    expect(
      parseScenarioParams({
        advanceRateBps: "7000",
        maximumDebtorShareBps: "5000",
        facilityLimitCents: "20000",
        reservesCents: "0",
      }),
    ).toMatchObject({
      requested: true,
      valid: true,
      values: { advanceRateBps: 7000, maximumDebtorShareBps: 5000 },
    });
  });

  it("hand-reconciles advance, reserve and cap alternatives against baseline", () => {
    const output = compareScenario("2026-10-20", policy, invoices, {
      ...inputs,
      advanceRateBps: 5000,
      reservesCents: 3000,
      facilityLimitCents: 12000,
    });
    expect(output.baseline.grossAdvanceCents).toBe(16000);
    expect(output.baseline.availableCents).toBe(16000);
    expect(output.counterfactual.grossAdvanceCents).toBe(10000);
    expect(output.counterfactual.securedAdvanceCents).toBe(7000);
    expect(output.counterfactual.availableCents).toBe(7000);
    expect(output.invoices.map((i) => i.advanceDeltaCents)).toEqual([
      -3000, -3000,
    ]);
    expect(
      output.waterfall.find((w) => w.field === "grossAdvanceCents")?.deltaCents,
    ).toBe(-6000);
    expect(
      output.waterfall.find((w) => w.field === "availableCents")?.deltaCents,
    ).toBe(-9000);
    expect(output.baseline.treatments.map((x) => x.invoiceId)).toEqual(
      output.counterfactual.treatments.map((x) => x.invoiceId),
    );
    const reset = compareScenario("2026-10-20", policy, invoices, inputs);
    expect(reset.waterfall.every((row) => row.deltaCents === 0)).toBe(true);
    expect(reset.invoices.every((row) => row.advanceDeltaCents === 0)).toBe(
      true,
    );
  });

  it("applies concentration and facility caps separately from invoice advances", () => {
    const concentrated = compareScenario("2026-10-20", policy, invoices, {
      ...inputs,
      maximumDebtorShareBps: 4000,
    });
    expect(concentrated.counterfactual.concentrationExcessCents).toBe(4000);
    expect(concentrated.counterfactual.grossAdvanceCents).toBe(12800);
    expect(concentrated.invoices.map((x) => x.concentrationDeltaCents)).toEqual(
      [2000, 2000],
    );
    const capped = compareScenario("2026-10-20", policy, invoices, {
      ...inputs,
      facilityLimitCents: 5000,
    });
    expect(capped.counterfactual.grossAdvanceCents).toBe(16000);
    expect(capped.counterfactual.availableCents).toBe(5000);
    expect(capped.invoices.every((x) => x.advanceDeltaCents === 0)).toBe(true);
  });

  it("does not reinstate ineligible invoices with aggressive assumptions", () => {
    const excluded: Receivable[] = invoices.map((row) => ({
      ...row,
      ineligibleReasons: ["STATUS_VOIDED"],
    }));
    const result = compareScenario("2026-10-20", policy, excluded, {
      ...inputs,
      advanceRateBps: 10000,
      maximumDebtorShareBps: 10000,
    });
    expect(result.counterfactual.eligibleCollateralCents).toBe(0);
    expect(result.counterfactual.availableCents).toBe(0);
    expect(
      result.invoices.every((row) =>
        row.exclusionReasons.includes("STATUS_VOIDED"),
      ),
    ).toBe(true);
  });

  it("reuses unchanged client-scoped dated ledger rows, never mixing borrowers", async () => {
    const db = await createMemoryDb();
    const ds = generate(DEV_PARAMS);
    await writeDataset(db, ds);
    const first = await clientBorrowingReview(
      db,
      ds.clients[0]!.id!,
      DEMO_TODAY,
    );
    const other = await clientBorrowingReview(
      db,
      ds.clients[1]!.id!,
      DEMO_TODAY,
    );
    const result = compareScenario(
      DEMO_TODAY,
      first!.policy,
      first!.receivables,
      {
        advanceRateBps: 6500,
        maximumDebtorShareBps: 4000,
        reservesCents: 10000,
        facilityLimitCents: first!.policy.facilityLimitCents,
      },
    );
    expect(result.baseline).toEqual(first!.report);
    expect(
      result.invoices.every((row) =>
        first!.evidence.ledgerInvoiceIds.includes(row.invoiceId),
      ),
    ).toBe(true);
    const foreign = new Set(other!.evidence.ledgerInvoiceIds);
    expect(result.invoices.every((row) => !foreign.has(row.invoiceId))).toBe(
      true,
    );
  }, 90_000);
});
