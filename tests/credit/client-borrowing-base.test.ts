import { describe, expect, it } from "vitest";

import { createMemoryDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { DEMO_TODAY } from "@/lib/demo";
import { indicativeClientBorrowingBase } from "@/lib/queries/client-borrowing-base";
import { getClientReceivablesAgeing } from "@/lib/queries/client-ageing";
import { getClientDossier } from "@/lib/queries/client-360";
import { DEV_PARAMS, generate } from "@/lib/seed/generate";
import { writeDataset } from "@/lib/seed/write";

describe("synthetic client-specific borrowing-base scenarios", () => {
  it("uses only that client's ledger invoice facts and reconciles to Client 360", async () => {
    const db = await createMemoryDb();
    const ds = generate(DEV_PARAMS);
    await writeDataset(db, ds);
    const clientId = ds.clients[0]!.id!;
    const scenario = await indicativeClientBorrowingBase(
      db,
      clientId,
      DEMO_TODAY,
    );
    const ageing = await getClientReceivablesAgeing(db, clientId, DEMO_TODAY);
    const dossier = await getClientDossier(db, clientId, DEMO_TODAY);

    expect(scenario?.status).toBe("SCENARIO_ONLY");
    expect(scenario?.report?.policyVersion).toBe("ILLUSTRATIVE-NOT-APPROVED");
    expect(scenario?.report?.netReceivablesCents).toBe(
      ageing?.totalOutstandingCents,
    );
    expect(scenario?.report?.facilityHeadroomCents).toBe(
      Math.max(0, dossier!.client.facilityLimitCents - dossier!.inUseCents),
    );
    expect(scenario?.report?.grossAdvanceCents).toBe(
      scenario?.report?.treatments.reduce(
        (sum, row) => sum + row.advanceCents,
        0,
      ),
    );
    expect(scenario?.report?.eligibleCollateralCents).toBe(
      scenario?.report?.treatments.reduce(
        (sum, row) => sum + row.eligibleCents,
        0,
      ),
    );

    const permittedInvoices = new Set(
      ds.ledgerEntries
        .filter((row) => row.clientId === clientId)
        .map((row) => row.id),
    );
    expect(scenario?.sourceInvoiceIds.length).toBeGreaterThan(0);
    expect(
      scenario?.sourceInvoiceIds.every((id) => permittedInvoices.has(id)),
    ).toBe(true);
    expect(scenario?.assumptions.join(" ")).toMatch(
      /NOT approved drawable funding/i,
    );
  }, 90_000);

  it("does not manufacture availability when the accounting source is empty", async () => {
    const db = await createMemoryDb();
    await db.insert(t.clients).values({
      id: "client-empty",
      name: "Empty synthetic borrower",
      industry: "services",
      advanceRateBps: 8000,
      facilityLimitCents: 200_000,
      paymentTermsDays: 30,
    });
    const result = await indicativeClientBorrowingBase(
      db,
      "client-empty",
      DEMO_TODAY,
    );
    expect(result).toMatchObject({
      status: "NO_SOURCE_RECORDS",
      report: null,
      sourceInvoiceIds: [],
    });
    await expect(
      indicativeClientBorrowingBase(db, "missing-client", DEMO_TODAY),
    ).resolves.toBeNull();
    await expect(
      indicativeClientBorrowingBase(db, "client-empty", "2026-09-31"),
    ).rejects.toThrow(/business date/);
  });

  it("keeps overdue receivables explicitly excluded at the policy boundary", async () => {
    const db = await createMemoryDb();
    await db.insert(t.clients).values({
      id: "client-aged",
      name: "Aged synthetic borrower",
      industry: "services",
      advanceRateBps: 8000,
      facilityLimitCents: 200_000,
      paymentTermsDays: 30,
    });
    await db.insert(t.debtors).values({
      id: "debtor-aged",
      clientId: "client-aged",
      name: "Past due debtor",
      nzbn: "9429000000022",
      firstSeenDate: "2026-01-01",
      creditBand: "C",
    });
    await db.insert(t.ledgerEntries).values({
      id: "aged-invoice",
      clientId: "client-aged",
      debtorId: "debtor-aged",
      invoiceNumber: "AGED-1",
      issueDate: "2026-01-01",
      recordedDate: "2026-01-01",
      amountCents: 50_000,
    });
    const result = await indicativeClientBorrowingBase(
      db,
      "client-aged",
      DEMO_TODAY,
    );
    expect(result?.report?.netReceivablesCents).toBe(50_000);
    expect(result?.report?.excludedCents).toBe(50_000);
    expect(result?.report?.availableCents).toBe(0);
    expect(result?.report?.treatments[0]?.reasons).toContain(
      "AGE_OVER_90_DAYS",
    );
  });
});
