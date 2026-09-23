import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Historical blood collection by institution and blood group",
  description:
    "Monthly blood units collected, including donors under 25, by region, institution and blood group, latest twelve reporting months. Null source measurements remain missing rather than becoming zero.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
};
