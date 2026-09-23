import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Historical hourly electricity consumption in postal areas 1000 and 4000",
  description:
    "Source-reported hourly consumption for four-digit postal areas 1000 (Lisbon) and 4000 (Porto), latest 168 source reporting hours. A fixed two-area comparison, not national consumption or a claim of real-time freshness.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
};
