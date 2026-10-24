import { describe, expect, it } from "vitest";

import { AkahuBankFeed } from "@/lib/data/akahu";
import { SyntheticBankFeed, SyntheticLedger } from "@/lib/data/synthetic";
import { XeroLedger } from "@/lib/data/xero";
import { createMemoryDb } from "@/lib/db/client";
import { DEV_PARAMS, generate } from "@/lib/seed/generate";
import { writeDataset } from "@/lib/seed/write";

describe("data source adapters", () => {
  it("serves the synthetic ledger and bank feed through the interfaces", async () => {
    const db = await createMemoryDb();
    const ds = generate(DEV_PARAMS);
    await writeDataset(db, ds);
    const clientId = ds.clients[0]!.id!;
    const ledger = await new SyntheticLedger(db).invoices(
      clientId,
      "2026-10-20",
    );
    const receipts = await new SyntheticBankFeed(db).receipts(
      clientId,
      "2026-01-01",
      "2026-10-20",
    );
    expect(ledger.length).toBeGreaterThan(0);
    expect(receipts.length).toBeGreaterThan(0);
    expect(ledger.every((i) => Number.isInteger(i.amountCents))).toBe(true);
    // The as-of view hides ledger entries recorded later.
    const early = await new SyntheticLedger(db).invoices(
      clientId,
      "2025-01-01",
    );
    expect(early.length).toBeLessThan(ledger.length);
  }, 60_000);

  it("reports the real integrations as not connected", async () => {
    await expect(new XeroLedger().invoices("c", "2026-10-20")).rejects.toThrow(
      /not connected/,
    );
    await expect(
      new AkahuBankFeed().receipts("c", "2026-01-01", "2026-10-20"),
    ).rejects.toThrow(/not connected/);
  });
});
