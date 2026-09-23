import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Monthly electricity consumption by four-digit postal area",
  description:
    "Billed active energy for every four-digit postal area published by E-REDES, latest six reporting months. These are postal areas, not seven-digit delivery addresses.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
};
