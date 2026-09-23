import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "IPMA weather warnings",
  description: "Weather warnings by district or island, with severity and validity periods.",
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
  topics: ["environment", "weather"],
};
