import type { DatasetDefinition } from "#/catalog/define";
import { MYINFO_NETWORK_POLICY } from "#/formats/myinfo/feeds";

export const DATASET: DatasetDefinition = {
  title: "Boa Viagem stops and lines",
  description: "Every bus stop Boa Viagem serves north of Lisbon, with its position, and every line and direction it runs.",
  licence: "source-terms",
  attribution: "Boa Viagem via myinfo.4cloud.pt",
  topics: ["mobility"],
  feeds: [
    {
      slug: "boa-viagem-network-feed",
      config: { source: "myinfo", feed: "network", operator: "BoaViagem" },
      policy: MYINFO_NETWORK_POLICY,
      staleAfterSeconds: 172_800,
    },
  ],
};
