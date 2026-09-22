import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "IPMA shellfish harvesting restrictions",
  description:
    "Production-zone polygons and the latest published permissions and restrictions by marine species. Partially open zones retain their separate open and closed species lists; consult IPMA's official bulletin before harvesting.",
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
  topics: ["environment", "health"],
  feeds: [
    {
      slug: "ipma-shellfish-restrictions-feed",
      config: { source: "ipma", feed: "shellfish-restrictions" },
      policy: {
        name: "IPMA shellfish bulletin",
        version: 2,
        collection: {
          cadenceSeconds: 21_600,
          timeoutSeconds: 90,
          maxBytes: 8 * 1024 * 1024,
          maxOutputBytes: 16 * 1024 * 1024,
          maxRecordBytes: 1024 * 1024,
          historyMode: "changes",
        },
      },
      staleAfterSeconds: 86_400,
    },
  ],
};
