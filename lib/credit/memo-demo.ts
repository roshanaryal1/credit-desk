import { DEMO_TODAY } from "@/lib/demo";

import { assembleCreditMemo, type CreditMemoDraft } from "./memo";

export interface SyntheticMemoClient {
  id: string;
  name: string;
  facilityLimitCents: number;
  fundsInUseCents: number;
}

/**
 * The only supported memo evidence on this prototype screen comes directly
 * from the versioned v1 seeded facility and as-of funding query. Request
 * amount, eligible collateral and risk judgment remain explicit gaps.
 */
export function draftMemoFromSyntheticClient(
  client: SyntheticMemoClient,
): CreditMemoDraft {
  const evidence = [
    {
      id: `facility:${client.id}:${DEMO_TODAY}`,
      clientId: client.id,
      asOfDate: DEMO_TODAY,
      fact: "COMMITTED_LIMIT" as const,
      cents: client.facilityLimitCents,
      sourceId: `seeded-client:${client.id}`,
      sourceLabel: "Synthetic facility record (current terms)",
    },
    {
      id: `funding:${client.id}:${DEMO_TODAY}`,
      clientId: client.id,
      asOfDate: DEMO_TODAY,
      fact: "OUTSTANDING_ADVANCES" as const,
      cents: client.fundsInUseCents,
      sourceId: `seeded-funded-position:${client.id}`,
      sourceLabel: "Synthetic funding journal (as-of position)",
    },
  ];

  return assembleCreditMemo(client.id, client.name, DEMO_TODAY, evidence);
}
