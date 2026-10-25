import { beforeAll, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/portfolio/export/route";
import { createMemoryDb, type Db } from "@/lib/db/client";
import { DEMO_TODAY } from "@/lib/demo";
import {
  renderPortfolioReviewPack,
  type PortfolioClientSnapshot,
} from "@/lib/portfolio/review-pack";
import { getClientDossier } from "@/lib/queries/client-360";
import { getClientReceivablesAgeing } from "@/lib/queries/client-ageing";
import { syntheticPortfolioReviewPack } from "@/lib/queries/portfolio-review-pack";
import { DEV_PARAMS, generate } from "@/lib/seed/generate";
import { writeDataset } from "@/lib/seed/write";

let db: Db;
vi.mock("@/lib/db/client", async (original) => ({
  ...(await original<typeof import("@/lib/db/client")>()),
  getDb: () => Promise.resolve(db),
}));

const example: PortfolioClientSnapshot = {
  id: "cli_demo",
  name: "=SUM(1,2) | Synthetic",
  facilityLimitCents: 1_000_000,
  fundedPrincipalCents: 135_001,
  commitmentHeadroomCents: 864_999,
  receivableOutstandingCents: 200_999,
  buckets: {
    CURRENT: 100_000,
    DAYS_1_30: 100_999,
    DAYS_31_60: 0,
    DAYS_61_90: 0,
    DAYS_90_PLUS: 0,
  },
  receiptsLast30DaysCents: 50_000,
  receiptsPrevious30DaysCents: 60_000,
  creditsLast30DaysCents: 0,
  invoiceIds: ["ledger_2", "ledger_1"],
  unresolvedIncidents: [
    {
      id: "incident_high",
      severity: "HIGH",
      firstDetectedDate: "2026-10-01",
    },
  ],
  sourceExceptions: ["Provider data not verified"],
};

describe("synthetic as-of portfolio review pack (#163)", () => {
  it("is deterministic, escapes Markdown and keeps finance metrics distinct", () => {
    const input = {
      asOf: "2026-10-20",
      configVersion: "test-1",
      selectedClientId: null,
      clients: [example],
    };
    const first = renderPortfolioReviewPack(input);
    expect(renderPortfolioReviewPack(input)).toEqual(first);
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.markdown).toContain("NZ$1,350.01");
    expect(first.markdown).toContain("NZ$8,649.99");
    expect(first.markdown).toContain("NZ$2,009.99");
    expect(first.markdown).toContain("including 1 high-severity");
    expect(first.markdown).toContain("\\=SUM");
    expect(first.markdown).toContain("\\| Synthetic");
    expect(first.markdown).toContain("ledger_1");
    expect(first.markdown).toContain("/clients/cli_demo/collections");
    expect(first.markdown).toContain("NOT drawable availability");
    expect(first.markdown).toContain(first.digest);
  });

  it("marks incomplete receivables unknown and produces a safe empty pack", () => {
    const missing = {
      ...example,
      id: "cli_missing",
      receivableOutstandingCents: null,
      buckets: null,
      receiptsLast30DaysCents: null,
      receiptsPrevious30DaysCents: null,
      creditsLast30DaysCents: null,
      invoiceIds: [],
    };
    const incomplete = renderPortfolioReviewPack({
      asOf: "2026-10-20",
      configVersion: "test-1",
      selectedClientId: null,
      clients: [example, missing],
    });
    expect(incomplete.markdown).toContain(
      "Ledger receivables outstanding: Unknown",
    );
    expect(incomplete.markdown).toContain("Receivables ageing: Unknown");
    expect(
      renderPortfolioReviewPack({
        asOf: "2026-10-20",
        configVersion: "test-1",
        selectedClientId: null,
        clients: [],
      }).markdown,
    ).toContain("No synthetic client records match");
  });

  beforeAll(async () => {
    db = await createMemoryDb();
    await writeDataset(db, generate(DEV_PARAMS));
  }, 60_000);

  it("reconciles every client to the existing ledger and facility queries", async () => {
    const pack = await syntheticPortfolioReviewPack(db, DEMO_TODAY, null);
    expect(pack).not.toBeNull();
    expect(pack!.clients.length).toBeGreaterThan(0);
    for (const client of pack!.clients) {
      const dossier = await getClientDossier(db, client.id, DEMO_TODAY);
      const ageing = await getClientReceivablesAgeing(
        db,
        client.id,
        DEMO_TODAY,
      );
      expect(client.fundedPrincipalCents).toBe(dossier!.inUseCents);
      expect(client.commitmentHeadroomCents).toBe(
        dossier!.commitmentHeadroomCents,
      );
      if (ageing!.debtors.length > 0) {
        expect(client.receivableOutstandingCents).toBe(
          ageing!.totalOutstandingCents,
        );
        expect(
          Object.values(client.buckets!).reduce((sum, cents) => sum + cents, 0),
        ).toBe(ageing!.totalOutstandingCents);
      } else {
        expect(client.receivableOutstandingCents).toBeNull();
      }
    }
    const selected = await syntheticPortfolioReviewPack(
      db,
      DEMO_TODAY,
      pack!.clients[0]!.id,
    );
    expect(selected!.clients).toHaveLength(1);
    expect(
      await syntheticPortfolioReviewPack(db, DEMO_TODAY, "missing-client"),
    ).toBeNull();
  }, 60_000);

  it("downloads a private read-only attachment and rejects invalid scopes", async () => {
    const res = await GET(
      new Request("https://example.com/portfolio/export?asOf=" + DEMO_TODAY),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("x-portfolio-digest")).toMatch(/^[0-9a-f]{64}$/);
    expect(await res.text()).toContain("FICTIONAL DATA");

    for (const url of [
      "https://example.com/portfolio/export?asOf=2026-02-30",
      "https://example.com/portfolio/export?asOf=9999-01-01",
      "https://example.com/portfolio/export?client=%2E%2E%2Fsecret",
    ]) {
      expect((await GET(new Request(url))).status).toBe(400);
    }
    const missing = await GET(
      new Request("https://example.com/portfolio/export?client=missing"),
    );
    expect(missing.status).toBe(404);
  }, 60_000);
});
