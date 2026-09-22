import type { DatasetDefinition } from "../../../catalog/define";

export const DATASET: DatasetDefinition = {
  title: "IPMA hourly station observations",
  description: "The last 24 hours of temperature, humidity, wind, precipitation, and pressure readings from IPMA stations.",
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
  topics: ["environment", "weather"],
  feeds: [
    {
      slug: "ipma-station-observations-feed",
      config: { source: "ipma", feed: "station-observations" },
      policy: {
        name: "IPMA hourly observations",
        version: 5,
        collection: {
          cadenceSeconds: 3_600,
          timeoutSeconds: 30,
          maxBytes: 3 * 1024 * 1024,
          historyMode: "changes",
          // The latest reading per station repeats values the observations series already records.
          withoutHistory: ["stations-latest"],
        },
      },
      staleAfterSeconds: 7_200,
    },
  ],
};
