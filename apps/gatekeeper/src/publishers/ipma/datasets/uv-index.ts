import type { DatasetDefinition } from "../../../catalog/define";

export const DATASET: DatasetDefinition = {
  title: "IPMA UV index forecast",
  description: "Daily UV index forecasts by IPMA forecast location and period.",
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
  topics: ["environment", "weather"],
  feeds: [
    {
      slug: "ipma-uv-index-feed",
      config: { source: "ipma", feed: "uv-index" },
      policy: {
        name: "IPMA UV forecast reference",
        version: 2,
        collection: {
          cadenceSeconds: 14_400,
          timeoutSeconds: 30,
          maxBytes: 128 * 1024,
          historyMode: "changes",
        },
      },
      staleAfterSeconds: 28_800,
    },
  ],
};
