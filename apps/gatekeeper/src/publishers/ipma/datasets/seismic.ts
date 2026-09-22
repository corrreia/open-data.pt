import type { DatasetDefinition } from "../../../catalog/define";

export const DATASET: DatasetDefinition = {
  title: "IPMA seismic events",
  description: "The latest 30-day seismic event lists for mainland Portugal, Madeira, and the Azores.",
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
  topics: ["environment"],
  feeds: [
    {
      slug: "ipma-seismic-feed",
      config: { source: "ipma", feed: "seismic" },
      policy: {
        name: "IPMA seismic changes",
        version: 3,
        collection: {
          cadenceSeconds: 3_600,
          timeoutSeconds: 30,
          maxBytes: 2 * 1024 * 1024,
          historyMode: "changes",
        },
      },
      staleAfterSeconds: 7_200,
    },
  ],
};
