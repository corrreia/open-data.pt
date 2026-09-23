import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "NASA POWER solar resource",
  description: "Daily solar irradiance and related weather around mainland Portugal, Madeira and the Azores.",
  licence: "nasa-earthdata",
  attribution: "NASA Prediction Of Worldwide Energy Resources (POWER) Project",
  topics: ["energy", "weather"],
};
