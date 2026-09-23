import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Recent EFFIS burnt areas in Portugal",
  description:
    "Burnt-area polygons attributed to Portugal in the continuously updated EFFIS MODIS database during the past 180 days, with fire dates, latest update, hectares and land-cover shares. Satellite-derived burnt areas are not emergency-service incident perimeters.",
  licence: "cc-by-4.0",
  attribution: "European Forest Fire Information System (EFFIS), European Commission Joint Research Centre",
  topics: ["environment"],
};
