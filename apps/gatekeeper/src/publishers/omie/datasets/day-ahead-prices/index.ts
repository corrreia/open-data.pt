import type { DatasetDefinition } from "#/catalog/define";

// One feed per file family: the seven-day window already holds every day a two-day Spanish feed would.
export const DATASET: DatasetDefinition = {
  title: "OMIE day-ahead prices",
  description: "The Portuguese day-ahead electricity price, hour by hour, as OMIE publishes it and across the coming week.",
  licence: "source-terms",
  attribution: "OMI, Polo Español S.A. (OMIE)",
  topics: ["energy"],
};
