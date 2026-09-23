import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Energy exported by self-consumption installations",
  description:
    "Monthly energy injected by self-consumption installations, summed by E-REDES into municipality and voltage-level totals for the latest six reporting months. Does not repeat the existing installation-count products.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
};
