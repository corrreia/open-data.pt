import type { DatasetDefinition } from "../../../catalog/define";
import { MYINFO_NETWORK_POLICY } from "../../../formats/myinfo/feeds";

export const DATASET: DatasetDefinition = {
  title: "Maré stops and lines",
  description: "Every bus stop Maré serves in Matosinhos, Maia, Valongo and Gondomar, with its position, and every line and direction it runs.",
  licence: "source-terms",
  attribution: "Maré via myinfo.4cloud.pt",
  topics: ["mobility"],
  feeds: [
    {
      slug: "mare-network-feed",
      config: { source: "myinfo", feed: "network", operator: "mare" },
      policy: MYINFO_NETWORK_POLICY,
      staleAfterSeconds: 172_800,
    },
  ],
};
