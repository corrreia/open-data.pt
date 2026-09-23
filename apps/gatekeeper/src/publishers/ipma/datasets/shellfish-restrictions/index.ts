import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "IPMA shellfish harvesting restrictions",
  description:
    "Production-zone polygons and the latest published permissions and restrictions by marine species. Partially open zones retain their separate open and closed species lists; consult IPMA's official bulletin before harvesting.",
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
  topics: ["environment", "health"],
};
