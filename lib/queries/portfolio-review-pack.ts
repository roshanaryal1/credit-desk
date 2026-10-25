import "server-only";

import { asc } from "drizzle-orm";

import { CONFIG_VERSION } from "@/lib/checks/config";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import {
  AGEING_BUCKETS,
  type AgeingBucket,
  type PortfolioClientSnapshot,
  type PortfolioReviewPack,
} from "@/lib/portfolio/review-pack";

import { getClientDossier } from "./client-360";
import { getClientReceivablesAgeing } from "./client-ageing";
import { incidentsAsOf } from "./watch";

/**
 * Synthetic-only aggregate from the same as-of read models as Client 360 and
 * Collections. Do not reuse for real tenants without an identity-bound guard.
 */
export async function syntheticPortfolioReviewPack(
  db: Db,
  asOf: string,
  selectedClientId: string | null,
): Promise<PortfolioReviewPack | null> {
  const all = await db.select().from(t.clients).orderBy(asc(t.clients.id));
  const chosen = selectedClientId
    ? all.filter((client) => client.id === selectedClientId)
    : all;
  if (selectedClientId && !chosen.length) return null;

  const incidents = await incidentsAsOf(asOf, db);
  const clients: PortfolioClientSnapshot[] = await Promise.all(
    chosen.map(async (client) => {
      const [dossier, ageing] = await Promise.all([
        getClientDossier(db, client.id, asOf),
        getClientReceivablesAgeing(db, client.id, asOf),
      ]);
      if (!dossier || !ageing) {
        throw new Error("Synthetic portfolio source could not be reconciled");
      }
      const known = ageing.debtors.length > 0;
      const buckets = known
        ? (Object.fromEntries(
            AGEING_BUCKETS.map((bucket) => [
              bucket,
              ageing.debtors.reduce(
                (sum, debtor) => sum + debtor.buckets[bucket],
                0,
              ),
            ]),
          ) as Record<AgeingBucket, number>)
        : null;
      const unresolvedIncidents = incidents
        .filter(
          (incident) =>
            incident.clientId === client.id && incident.status !== "RESOLVED",
        )
        .map((incident) => ({
          id: incident.id,
          severity: incident.severity,
          firstDetectedDate: incident.firstDetectedDate,
        }));
      const sourceExceptions = [
        "Provider freshness UNKNOWN: no consented Xero or Akahu feed is connected.",
      ];
      if (!known) {
        sourceExceptions.push(
          "No dated ledger invoices available; receivables completeness UNKNOWN.",
        );
      }
      const invoiceIds = known
        ? ageing.debtors.flatMap((debtor) =>
            debtor.invoices.map((invoice) => invoice.invoiceId),
          )
        : [];
      return {
        id: client.id,
        name: client.name,
        facilityLimitCents: client.facilityLimitCents,
        fundedPrincipalCents: dossier.inUseCents,
        commitmentHeadroomCents: dossier.commitmentHeadroomCents,
        receivableOutstandingCents: known ? ageing.totalOutstandingCents : null,
        buckets,
        receiptsLast30DaysCents: known
          ? ageing.collections.reduce(
              (sum, debtor) => sum + debtor.receiptsLast30DaysCents,
              0,
            )
          : null,
        receiptsPrevious30DaysCents: known
          ? ageing.collections.reduce(
              (sum, debtor) => sum + debtor.receiptsPrevious30DaysCents,
              0,
            )
          : null,
        creditsLast30DaysCents: known
          ? ageing.collections.reduce(
              (sum, debtor) => sum + debtor.creditsLast30DaysCents,
              0,
            )
          : null,
        invoiceIds,
        unresolvedIncidents,
        sourceExceptions,
      };
    }),
  );
  return { asOf, selectedClientId, configVersion: CONFIG_VERSION, clients };
}
