import type { DatasetDefinition } from "../../../catalog/define";

export const DATASET: DatasetDefinition = {
  title: "IPMA municipal fire risk",
  description: "Three-day rural fire danger forecasts by municipality code.",
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
  topics: ["environment"],
  feeds: [
    {
      slug: "ipma-fire-risk-feed",
      config: { source: "ipma", feed: "fire-risk" },
      policy: {
        name: "IPMA fire-risk current state",
        version: 2,
        collection: {
          cadenceSeconds: 14_400,
          timeoutSeconds: 30,
          maxBytes: 128 * 1024,
          historyMode: "latest",
        },
      },
      staleAfterSeconds: 28_800,
    },
  ],
};
