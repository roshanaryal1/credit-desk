import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { addDays, daysBetween } from "@/lib/dates";
import { createMemoryDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { DEMO_TODAY, HISTORY_DAYS } from "@/lib/demo";
import { DEV_PARAMS, HOLDOUT_PARAMS, generate } from "@/lib/seed/generate";
import { gs1CheckDigit } from "@/lib/seed/names";
import { summarise, writeDataset } from "@/lib/seed/write";

describe("synthetic data generator", () => {
  const dev = generate(DEV_PARAMS);

  it("is deterministic", () => {
    expect(generate(DEV_PARAMS)).toEqual(dev);
    expect(generate(HOLDOUT_PARAMS)).toEqual(generate(HOLDOUT_PARAMS));
  });

  it("produces a different holdout dataset with distinct ids", () => {
    const holdout = generate(HOLDOUT_PARAMS);
    expect(holdout.invoices.map((i) => i.amountCents)).not.toEqual(
      dev.invoices.map((i) => i.amountCents),
    );
    const devIds = new Set(dev.invoices.map((i) => i.id));
    expect(holdout.invoices.some((i) => devIds.has(i.id))).toBe(false);
  });

  it("matches the shape in SPEC 5", () => {
    expect(dev.clients).toHaveLength(4);
    expect(dev.debtors).toHaveLength(40);
    expect(dev.batches).toHaveLength(8);
    expect(dev.batches.filter((b) => b.status === "PENDING")).toHaveLength(2);
    expect(dev.invoices.length).toBeGreaterThanOrEqual(220);
    expect(dev.invoices.length).toBeLessThanOrEqual(280);
    expect(dev.fundings.length).toBeGreaterThanOrEqual(130);
  });

  it("labels about 15% of invoices and every invoice has a label row", () => {
    const share = summarise(dev).labelledShare;
    expect(share).toBeGreaterThanOrEqual(0.12);
    expect(share).toBeLessThanOrEqual(0.18);
    expect(dev.labels).toHaveLength(dev.invoices.length);
  });

  it("covers every check id with at least one labelled invoice", () => {
    const seen = new Set(dev.labels.flatMap((l) => l.expectedCheckIds));
    for (const id of [
      "DUP",
      "LEDGER_MISSING",
      "LEDGER_MISMATCH",
      "VOIDED",
      "CREDIT_NOTE",
      "ALREADY_PAID",
      "NEW_DEBTOR",
      "SLOW_PAYER",
      "OVER_AGE",
      "FUTURE_DATED",
      "CONCENTRATION",
    ]) {
      expect(seen.has(id), id).toBe(true);
    }
    expect(dev.labels.some((l) => l.expectedCheckIds.length > 1)).toBe(true);
  });

  it("includes the tricky clean cases without the labels they imitate", () => {
    const cases = Object.entries(dev.cleanCases);
    expect(cases.map(([, c]) => c).sort()).toEqual([
      "PARTIAL_PAYMENT",
      "REISSUED",
    ]);
    const labelOf = (id: string) =>
      dev.labels.find((l) => l.invoiceId === id)?.expectedCheckIds ?? [];
    for (const [invoiceId, kind] of cases) {
      const imitated = kind === "PARTIAL_PAYMENT" ? "ALREADY_PAID" : "DUP";
      expect(labelOf(invoiceId)).not.toContain(imitated);
    }
  });

  it("places the scripted portfolio events inside the history window", () => {
    const start = addDays(DEMO_TODAY, -HISTORY_DAYS);
    const kinds = dev.scriptedEvents.map((e) => e.kind).sort();
    expect(kinds).toEqual([
      "CONCENTRATION_CREEP",
      "FUNDED_CREDIT_NOTE",
      "OVERDUE_FUNDED",
      "OVERDUE_FUNDED",
      "PAYMENT_DRIFT",
    ]);
    for (const e of dev.scriptedEvents) {
      expect(
        e.date >= start && e.date <= DEMO_TODAY,
        `${e.kind} ${e.date}`,
      ).toBe(true);
    }
    for (const kind of new Set(kinds)) {
      expect(
        dev.watchLabels.some((l) => l.ruleId === kind),
        kind,
      ).toBe(true);
    }
  });

  it("labels every watch incident inside the history and none for facilities", () => {
    const start = addDays(DEMO_TODAY, -HISTORY_DAYS);
    for (const l of dev.watchLabels) {
      expect(
        l.expectedFromDate >= start && l.expectedFromDate <= DEMO_TODAY,
      ).toBe(true);
    }
    expect(
      dev.watchLabels.some((l) => l.ruleId === "FACILITY_UTILISATION"),
    ).toBe(false);
  });

  it("labels date facts from the dates, including resubmitted invoices", () => {
    for (const ds of [dev, generate(HOLDOUT_PARAMS)]) {
      for (const inv of ds.invoices) {
        const sub = ds.batches.find((b) => b.id === inv.batchId)!.submittedDate;
        const labels = ds.labels.find(
          (l) => l.invoiceId === inv.id,
        )!.expectedCheckIds;
        expect(labels.includes("OVER_AGE"), inv.id!).toBe(
          daysBetween(inv.issueDate, sub) > 90,
        );
        expect(labels.includes("FUTURE_DATED"), inv.id!).toBe(
          inv.issueDate > sub,
        );
      }
    }
  });

  it("never uses a valid NZBN check digit", () => {
    for (const d of dev.debtors) {
      expect(d.nzbn).toMatch(/^9429\d{9}$/);
      expect(Number(d.nzbn.slice(12))).not.toBe(
        gs1CheckDigit(d.nzbn.slice(0, 12)),
      );
    }
  });

  it("keeps money in integer cents and advances at the client rate", () => {
    for (const f of dev.fundings) {
      const inv = dev.invoices.find((i) => i.id === f.invoiceId)!;
      expect(Number.isInteger(f.advanceCents)).toBe(true);
      expect(f.advanceCents).toBe(
        Math.floor((inv.amountCents * 8000) / 10_000),
      );
    }
  });

  it("funds only invoices from reviewed batches, after submission", () => {
    for (const f of dev.fundings) {
      const inv = dev.invoices.find((i) => i.id === f.invoiceId)!;
      const batch = dev.batches.find((b) => b.id === inv.batchId)!;
      expect(batch.status).toBe("REVIEWED");
      expect(daysBetween(batch.submittedDate, f.fundedDate)).toBe(1);
    }
  });

  it("writes to the database with matching row counts", async () => {
    const db = await createMemoryDb();
    await writeDataset(db, dev);
    const [inv] = await db.select({ n: count() }).from(t.invoices);
    const [led] = await db.select({ n: count() }).from(t.ledgerEntries);
    expect(inv?.n).toBe(dev.invoices.length);
    expect(led?.n).toBe(dev.ledgerEntries.length);
  }, 60_000);
});
