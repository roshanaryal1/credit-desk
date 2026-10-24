import { describe, expect, it } from "vitest";

import { createMemoryDb } from "@/lib/db/client";
import { getClientDossier } from "@/lib/queries/client-360";
import { DEV_PARAMS, generate } from "@/lib/seed/generate";
import { writeDataset } from "@/lib/seed/write";

describe("client dossier", () => {
  it("isolates all rows to one client and reconciles submitted face value", async () => {
    const db = await createMemoryDb();
    const ds = generate(DEV_PARAMS);
    await writeDataset(db, ds);
    const clientId = ds.clients[0]!.id!;
    const d = await getClientDossier(db, clientId, "2026-10-20");
    expect(d?.client.id).toBe(clientId);
    expect(d?.submittedFaceCents).toBe(d?.batches.reduce((sum,b) => sum + b.faceCents,0));
    expect(d?.submittedFaceCents).toBe(d?.debtors.reduce((sum,x) => sum + x.submittedFaceCents,0));
    expect(d?.inUseCents).toBe(d?.debtors.reduce((sum,x) => sum + x.fundedOutstandingCents,0));
    expect(d?.commitmentHeadroomCents).toBe(Math.max(0,d!.client.facilityLimitCents-d!.inUseCents));
    expect(d?.incidents.every((i) => i.firstDetectedDate <= d.asOf)).toBe(true);
    expect(d?.debtors.every((x) => x.submittedFaceCents >= 0)).toBe(true);
  }, 60_000);

  it("rejects invalid as-of and returns null for missing clients", async () => {
    const db = await createMemoryDb();
    await expect(getClientDossier(db, "nobody", "2026-10-20")).resolves.toBeNull();
    await expect(getClientDossier(db, "nobody", "2026-09-31")).rejects.toThrow(/business date/);
  });
});
