import { count } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { createMemoryDb, type Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { DEMO_TODAY } from "@/lib/demo";
import { DEV_PARAMS, generate } from "@/lib/seed/generate";
import { writeDataset } from "@/lib/seed/write";
import {
  concentrationCreep,
  facilityUtilisation,
  fundedCreditNote,
  overdueFunded,
  paymentDrift,
} from "@/lib/watch/rules";
import { runWatchForDate, runWatchRange } from "@/lib/watch/runner";
import type { Book } from "@/lib/watch/types";

type Funding = Book["fundings"][number];

const funding = (over: Partial<Funding> = {}): Funding => ({
  id: "fnd_1",
  invoiceId: "inv_1",
  clientId: "cli_1",
  debtorId: "dbt_1",
  ledgerEntryId: "led_1",
  dueDate: "2026-09-01",
  fundedDate: "2026-08-01",
  advanceCents: 80_000,
  adjustments: [],
  ...over,
});

const book = (over: Partial<Book> = {}): Book => ({
  asOf: "2026-10-01",
  clients: [{ id: "cli_1", facilityLimitCents: 1_000_000 }],
  fundings: [],
  creditNotes: [],
  payments: [],
  ...over,
});

const payments = (debtorId: string, paidDates: string[], days: number) =>
  paidDates.map((paidDate, i) => {
    const d = new Date(`${paidDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return {
      id: `pay_${debtorId}_${i}_${days}`,
      debtorId,
      clientId: "cli_1",
      issueDate: d.toISOString().slice(0, 10),
      paidDate,
    };
  });

describe("OVERDUE_FUNDED", () => {
  it("fires more than 30 days past due while outstanding", () => {
    expect(
      overdueFunded(book({ fundings: [funding({ dueDate: "2026-08-31" })] })),
    ).toHaveLength(1);
  });
  it("does not fire once collected", () => {
    const f = funding({
      dueDate: "2026-08-01",
      adjustments: [{ id: "adj", date: "2026-09-20", amountCents: 80_000 }],
    });
    expect(overdueFunded(book({ fundings: [f] }))).toHaveLength(0);
  });
  it("does not fire at exactly 30 days", () => {
    expect(
      overdueFunded(book({ fundings: [funding({ dueDate: "2026-09-01" })] })),
    ).toHaveLength(0);
  });
});

describe("FUNDED_CREDIT_NOTE", () => {
  it("fires for a credit note on an outstanding funded invoice", () => {
    const b = book({
      fundings: [funding()],
      creditNotes: [
        {
          id: "cn",
          ledgerEntryId: "led_1",
          date: "2026-09-15",
          amountCents: 1000,
        },
      ],
    });
    expect(fundedCreditNote(b)[0]?.evidenceIds).toContain("cn");
  });
  it("ignores credit notes dated after the as-of date", () => {
    const b = book({
      fundings: [funding()],
      creditNotes: [
        {
          id: "cn",
          ledgerEntryId: "led_1",
          date: "2026-10-02",
          amountCents: 1000,
        },
      ],
    });
    expect(fundedCreditNote(b)).toHaveLength(0);
  });
  it("ignores fully collected fundings", () => {
    const f = funding({
      adjustments: [{ id: "adj", date: "2026-09-01", amountCents: 80_000 }],
    });
    const b = book({
      fundings: [f],
      creditNotes: [
        {
          id: "cn",
          ledgerEntryId: "led_1",
          date: "2026-09-15",
          amountCents: 1000,
        },
      ],
    });
    expect(fundedCreditNote(b)).toHaveLength(0);
  });
});

describe("CONCENTRATION_CREEP", () => {
  const twoDebtors = (bigFunded: string) => [
    funding({
      id: "a",
      debtorId: "dbt_1",
      advanceCents: 50_000,
      fundedDate: "2026-08-01",
    }),
    funding({
      id: "b",
      debtorId: "dbt_2",
      advanceCents: 50_000,
      fundedDate: "2026-08-01",
    }),
    funding({
      id: "c",
      debtorId: "dbt_3",
      advanceCents: 50_000,
      fundedDate: "2026-08-01",
    }),
    funding({
      id: "e",
      debtorId: "dbt_4",
      advanceCents: 50_000,
      fundedDate: "2026-08-01",
    }),
    funding({
      id: "d",
      debtorId: "dbt_1",
      advanceCents: 50_000,
      fundedDate: bigFunded,
    }),
  ];
  it("fires on the day a debtor crosses 30%", () => {
    const r = concentrationCreep(book({ fundings: twoDebtors("2026-10-01") }));
    expect(r.map((d) => d.debtorId)).toEqual(["dbt_1"]);
  });
  it("does not fire again the day after crossing", () => {
    expect(
      concentrationCreep(book({ fundings: twoDebtors("2026-09-30") })),
    ).toHaveLength(0);
  });
  it("handles an empty book", () => {
    expect(concentrationCreep(book())).toEqual([]);
  });
});

describe("FACILITY_UTILISATION", () => {
  it("fires over 90% of the limit", () => {
    expect(
      facilityUtilisation(
        book({ fundings: [funding({ advanceCents: 950_000 })] }),
      ),
    ).toHaveLength(1);
  });
  it("does not fire at exactly 90%", () => {
    expect(
      facilityUtilisation(
        book({ fundings: [funding({ advanceCents: 900_000 })] }),
      ),
    ).toHaveLength(0);
  });
});

describe("PAYMENT_DRIFT", () => {
  const recent = ["2026-09-05", "2026-09-15", "2026-09-25"];
  const prior = ["2026-07-01", "2026-07-15", "2026-07-25"];
  it("fires when recent days-to-pay rise by more than 15", () => {
    const b = book({
      payments: [
        ...payments("dbt_1", recent, 70),
        ...payments("dbt_1", prior, 35),
      ],
    });
    expect(paymentDrift(b)[0]?.details).toMatchObject({
      recentMeanDays: 70,
      priorMeanDays: 35,
    });
  });
  it("needs three payments in each window", () => {
    const b = book({
      payments: [
        ...payments("dbt_1", recent.slice(0, 2), 70),
        ...payments("dbt_1", prior, 35),
      ],
    });
    expect(paymentDrift(b)).toHaveLength(0);
  });
  it("does not fire for an increase of exactly 15 days", () => {
    const b = book({
      payments: [
        ...payments("dbt_1", recent, 50),
        ...payments("dbt_1", prior, 35),
      ],
    });
    expect(paymentDrift(b)).toHaveLength(0);
  });
});

describe("watch runner", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createMemoryDb();
    await writeDataset(db, generate(DEV_PARAMS));
  }, 60_000);

  it("is idempotent: running a date twice adds nothing", async () => {
    await runWatchRange(db, "2026-09-01", DEMO_TODAY);
    const count1 = await db.select({ n: count() }).from(t.watchDetections);
    const ev1 = await db.select({ n: count() }).from(t.incidentEvents);
    await runWatchForDate(db, DEMO_TODAY);
    await runWatchRange(db, "2026-09-01", DEMO_TODAY);
    const count2 = await db.select({ n: count() }).from(t.watchDetections);
    const ev2 = await db.select({ n: count() }).from(t.incidentEvents);
    expect(count2[0]?.n).toBe(count1[0]?.n);
    expect(ev2[0]?.n).toBe(ev1[0]?.n);
    expect(count1[0]?.n).toBeGreaterThan(0);
  }, 60_000);

  it("opens one incident per key, not one per day", async () => {
    const incidents = await db.select().from(t.incidents);
    const keys = new Set(incidents.map((i) => i.incidentKey));
    expect(keys.size).toBe(incidents.length);
    const [det] = await db.select({ n: count() }).from(t.watchDetections);
    expect(det!.n).toBeGreaterThan(incidents.length);
  });
});
