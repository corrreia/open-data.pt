import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Distribution transformer stations by municipality",
  description:
    "A source-computed count of distribution transformer stations and their total installed capacity by municipality across the E-REDES service area. This is a municipal inventory summary, not individual station locations.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
};
