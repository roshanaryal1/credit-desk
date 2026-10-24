import { describe, expect, it } from "vitest";

import { createMemoryDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { DEMO_TODAY } from "@/lib/demo";
import { indicativeClientBorrowingBase } from "@/lib/queries/client-borrowing-base";
import { clientBorrowingReview } from "@/lib/queries/client-borrowing-review";
import { DEV_PARAMS, generate } from "@/lib/seed/generate";
import { writeDataset } from "@/lib/seed/write";

async function seeded() {
  const db = await createMemoryDb();
  const ds = generate(DEV_PARAMS);
  await writeDataset(db, ds);
  const clientId = ds.clients[0]!.id!;
  return { db, ds, clientId };
}

describe("client ledger borrowing-base preview", () => {
  it("reconciles an actual seeded client without inventing drawable credit", async () => {
    const { db, ds, clientId } = await seeded();
    const result = await clientBorrowingReview(db, clientId, DEMO_TODAY);
    expect(result?.releaseStatus).toBe("NOT_VERIFIED_FOR_DRAWING");
    expect(result?.report.policyVersion).toBe("ILLUSTRATIVE-NOT-APPROVED");
    expect(result?.report.netReceivablesCents).toBe(
      result?.ageing.totalOutstandingCents,
    );
    expect(result?.policy.drawnCents).toBeGreaterThanOrEqual(0);
    expect(
      result?.report.treatments.every((item) =>
        ds.ledgerEntries.some(
          (entry) => entry.id === item.invoiceId && entry.clientId === clientId,
        ),
      ),
    ).toBe(true);
    expect(result?.blockers.some((x) => x.includes("lender-approved"))).toBe(
      true,
    );
    expect([...result!.evidence.ledgerInvoiceIds].sort()).toEqual(
      result!.report.treatments.map((item) => item.invoiceId).sort(),
    );
  }, 90_000);

  it("separates client partitions and excludes unknown invoice status", async () => {
    const { db, ds, clientId } = await seeded();
    const otherClientId = ds.clients[1]!.id!;
    const debtorId = ds.debtors.find((d) => d.clientId === clientId)!.id!;
    await db.insert(t.ledgerEntries).values({
      id: "incomplete-ledger-source",
      clientId,
      invoiceNumber: "SOURCE-STATUS-UNKNOWN",
      debtorId,
      amountCents: 22_000,
      issueDate: "2026-10-02",
      recordedDate: "2026-10-02",
    });
    const result = await clientBorrowingReview(db, clientId, DEMO_TODAY);
    const excluded = result?.report.treatments.find(
      (item) => item.invoiceId === "incomplete-ledger-source",
    );
    expect(excluded?.reasons).toContain("STATUS_UNVERIFIED");
    expect(excluded?.eligibleCents).toBe(0);
    expect(excluded?.advanceCents).toBe(0);
    const other = await clientBorrowingReview(db, otherClientId, DEMO_TODAY);
    expect(
      other?.report.treatments.some(
        (item) => item.invoiceId === "incomplete-ledger-source",
      ),
    ).toBe(false);
    expect(other?.clientId).toBe(otherClientId);
  }, 90_000);

  it("fails closed when a provider records conflicting statuses on one day", async () => {
    const { db, clientId, ds } = await seeded();
    const debtorId = ds.debtors.find((d) => d.clientId === clientId)!.id!;
    await db.insert(t.ledgerEntries).values({
      id: "ambiguous-source",
      clientId,
      invoiceNumber: "SOURCE-AMBIGUOUS",
      debtorId,
      amountCents: 12_000,
      issueDate: "2026-10-05",
      recordedDate: "2026-10-05",
    });
    await db.insert(t.ledgerStatusEvents).values([
      {
        ledgerEntryId: "ambiguous-source",
        status: "AUTHORISED",
        effectiveDate: "2026-10-20",
      },
      {
        ledgerEntryId: "ambiguous-source",
        status: "VOIDED",
        effectiveDate: "2026-10-20",
      },
    ]);
    const result = await clientBorrowingReview(db, clientId, DEMO_TODAY);
    const row = result?.report.treatments.find(
      (item) => item.invoiceId === "ambiguous-source",
    );
    expect(row?.reasons).toContain("STATUS_CONFLICT");
    expect(row?.advanceCents).toBe(0);
  }, 90_000);

  it("returns no data for unknown clients and validates dates", async () => {
    const { db } = await seeded();
    expect(await clientBorrowingReview(db, "unknown", DEMO_TODAY)).toBeNull();
    await expect(
      clientBorrowingReview(db, "unknown", "2026-09-31"),
    ).rejects.toThrow(/business date/);
  }, 90_000);

  it("excludes paid and voided balances while keeping future statuses out of the canonical view", async () => {
    const { db, ds, clientId } = await seeded();
    const debtorId = ds.debtors.find((d) => d.clientId === clientId)!.id!;
    const ids = ["status-paid", "status-voided", "status-future"];
    await db.insert(t.ledgerEntries).values(
      ids.map((id) => ({
        id,
        clientId,
        debtorId,
        invoiceNumber: id,
        amountCents: 12_000,
        issueDate: "2026-10-05",
        recordedDate: "2026-10-05",
      })),
    );
    await db.insert(t.ledgerStatusEvents).values([
      ...ids.map((ledgerEntryId) => ({
        ledgerEntryId,
        status: "AUTHORISED" as const,
        effectiveDate: "2026-10-05",
      })),
      {
        ledgerEntryId: "status-paid",
        status: "PAID",
        effectiveDate: "2026-10-19",
      },
      {
        ledgerEntryId: "status-voided",
        status: "VOIDED",
        effectiveDate: "2026-10-19",
      },
      {
        ledgerEntryId: "status-future",
        status: "PAID",
        effectiveDate: "2026-10-21",
      },
    ]);

    const review = await clientBorrowingReview(db, clientId, "2026-10-20");
    for (const [id, reason] of [
      ["status-paid", "STATUS_PAID"],
      ["status-voided", "STATUS_VOIDED"],
    ]) {
      const row = review!.report.treatments.find(
        (item) => item.invoiceId === id,
      );
      expect(row).toMatchObject({
        netCents: 12_000,
        excludedCents: 12_000,
        eligibleCents: 0,
        advanceCents: 0,
      });
      expect(row!.reasons).toContain(reason);
    }
    const future = review!.report.treatments.find(
      (item) => item.invoiceId === "status-future",
    )!;
    expect(future.excludedCents).toBe(0);
    expect(future.reasons).not.toContain("STATUS_PAID");
    expect(future.reasons).not.toContain("STATUS_UNVERIFIED");

    const canonical = await indicativeClientBorrowingBase(
      db,
      clientId,
      "2026-10-20",
    );
    expect(canonical?.report).toEqual(review?.report);

    const after = await clientBorrowingReview(db, clientId, "2026-10-21");
    expect(
      after!.report.treatments.find(
        (item) => item.invoiceId === "status-future",
      ),
    ).toMatchObject({
      excludedCents: 12_000,
      advanceCents: 0,
      reasons: ["STATUS_PAID"],
    });
  }, 90_000);
});
