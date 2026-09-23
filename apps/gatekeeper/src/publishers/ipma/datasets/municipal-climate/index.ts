import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "IPMA daily municipal climate",
  description: "Daily precipitation and temperature for each mainland municipality, as IPMA publishes them.",
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
  topics: ["environment", "weather"],
};
