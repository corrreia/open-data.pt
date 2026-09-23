import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Porto shared micromobility parking",
  description:
    "Parking spots for shared scooters and bicycles in Porto: where each is, the spaces it holds and how many of them are free. The broker keeps no clock for these, so each reading is what was true when it was asked.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal do Porto — Urban Platform",
  topics: ["cities", "mobility"],
};
