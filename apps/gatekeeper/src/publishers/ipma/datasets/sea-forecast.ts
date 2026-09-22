import type { DatasetDefinition } from "../../../catalog/define";

export const DATASET: DatasetDefinition = {
  title: "IPMA three-day sea forecast",
  description: "Wave and sea-surface forecasts for Portuguese coastal locations for today and the following two days.",
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
  topics: ["environment", "weather"],
  feeds: [
    {
      slug: "ipma-sea-forecast-feed",
      config: { source: "ipma", feed: "sea-forecast" },
      policy: {
        name: "IPMA sea forecast reference",
        version: 3,
        collection: {
          cadenceSeconds: 3_600,
          timeoutSeconds: 30,
          maxBytes: 64 * 1024,
          historyMode: "changes",
        },
      },
      staleAfterSeconds: 7_200,
    },
  ],
};
