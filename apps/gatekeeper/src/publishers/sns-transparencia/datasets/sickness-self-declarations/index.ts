import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Sickness self-declarations by channel, sex and age",
  description: "Daily counts of sickness self-declarations, partitioned by source channel, sex and age group, latest sixty source reporting days. No individual health records.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
};
