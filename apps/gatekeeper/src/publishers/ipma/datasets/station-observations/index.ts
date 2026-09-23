import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "IPMA hourly station observations",
  description: "The last 24 hours of temperature, humidity, wind, precipitation, and pressure readings from IPMA stations.",
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
  topics: ["environment", "weather"],
};
