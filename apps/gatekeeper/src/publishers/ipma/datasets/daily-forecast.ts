import type { DatasetDefinition } from "../../../catalog/define";

export const DATASET: DatasetDefinition = {
  title: "IPMA three-day city forecast",
  description: "Daily weather forecasts for Portuguese district capitals and islands for today and the following two days.",
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
  topics: ["environment", "weather"],
  feeds: [
    {
      slug: "ipma-daily-forecast-feed",
      config: { source: "ipma", feed: "daily-forecast" },
      policy: {
        name: "IPMA forecast reference",
        version: 3,
        collection: {
          cadenceSeconds: 3_600,
          timeoutSeconds: 30,
          maxBytes: 2 * 1024 * 1024,
          historyMode: "changes",
        },
      },
      staleAfterSeconds: 3_600,
    },
  ],
};
