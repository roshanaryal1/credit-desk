import { describe, expect, it } from "vitest";

import { draftMemoFromSyntheticClient } from "@/lib/credit/memo-demo";
import { demonstrationWorksheet } from "@/lib/credit/demo-worksheet";
import { createMemoryDb } from "@/lib/db/client";
import { DEMO_TODAY } from "@/lib/demo";
import { getClientReceivablesAgeing } from "@/lib/queries/client-ageing";
import { getClientDossier } from "@/lib/queries/client-360";
import { DEV_PARAMS, generate } from "@/lib/seed/generate";
import { writeDataset } from "@/lib/seed/write";

describe("integrated Credit Desk v2 seeded review journey", () => {
  it("reconciles a client dossier, debtor ageing and memo facts without cross-client mixing", async () => {
    const db = await createMemoryDb();
    const ds = generate(DEV_PARAMS);
    await writeDataset(db, ds);

    const clientId = ds.clients[0]!.id!;
    const [dossier, ageing] = await Promise.all([
      getClientDossier(db, clientId, DEMO_TODAY),
      getClientReceivablesAgeing(db, clientId, DEMO_TODAY),
    ]);
    expect(dossier?.client.id).toBe(clientId);
    expect(ageing?.clientId).toBe(clientId);
    expect(dossier?.inUseCents).toBe(
      dossier?.debtors.reduce(
        (total, row) => total + row.fundedOutstandingCents,
        0,
      ),
    );
    expect(ageing?.totalOutstandingCents).toBe(
      ageing?.debtors.reduce(
        (total, row) => total + row.grossOutstandingCents,
        0,
      ),
    );
    expect(ageing?.overdueCents).toBe(
      ageing?.debtors.reduce(
        (total, row) => total + row.overdueCents,
        0,
      ),
    );

    const memo = draftMemoFromSyntheticClient({
      id: clientId,
      name: dossier!.client.name,
      facilityLimitCents: dossier!.client.facilityLimitCents,
      fundsInUseCents: dossier!.inUseCents,
    });
    expect(memo.status).toBe("DRAFT_REVIEW_REQUIRED");
    expect(memo.signedOffBy).toBeNull();
    expect(memo.evidenceIndex).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fact: "OUTSTANDING_ADVANCES",
          cents: dossier!.inUseCents,
          clientId,
        }),
        expect.objectContaining({
          fact: "COMMITTED_LIMIT",
          cents: dossier!.client.facilityLimitCents,
          clientId,
        }),
      ]),
    );
    expect(memo.missingItems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Eligible receivables"),
        expect.stringContaining("Independent credit decision"),
      ]),
    );

    const secondClientId = ds.clients[1]!.id!;
    const other = await getClientDossier(db, secondClientId, DEMO_TODAY);
    expect(other?.client.id).toBe(secondClientId);
    expect(dossier?.debtors.every((d) =>
      ds.debtors.some((source) => source.id === d.id && source.clientId === clientId),
    )).toBe(true);
    expect(other?.debtors.every((d) =>
      ds.debtors.some((source) => source.id === d.id && source.clientId === secondClientId),
    )).toBe(true);
  }, 90_000);

  it("keeps the illustrative borrowing base separate from actual client availability", () => {
    const result = demonstrationWorksheet("baseline");
    expect(result.policyVersion).toMatch(/DEMO/);
    expect(result.availableCents).toBe(0);
    expect(result.overdrawnCents).toBeGreaterThan(0);
  });
});
