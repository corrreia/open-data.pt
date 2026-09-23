import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Electricity consumption forecast",
  description: "E-REDES 15-minute consumption forecast by voltage level, from the past day to seven days ahead.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
};
