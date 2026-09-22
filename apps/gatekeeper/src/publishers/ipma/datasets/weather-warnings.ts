import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "IPMA weather warnings",
  description: "Weather warnings by district or island, with severity and validity periods.",
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
  topics: ["environment", "weather"],
  feeds: [
    {
      slug: "ipma-weather-warnings-feed",
      config: { source: "ipma", feed: "warnings" },
      policy: {
        name: "IPMA warning changes",
        version: 3,
        collection: {
          cadenceSeconds: 1_800,
          timeoutSeconds: 30,
          maxBytes: 128 * 1024,
          historyMode: "changes",
        },
      },
      staleAfterSeconds: 3_600,
    },
  ],
};
