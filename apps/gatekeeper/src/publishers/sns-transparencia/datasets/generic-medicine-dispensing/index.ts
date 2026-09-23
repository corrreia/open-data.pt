import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Generic medicine dispensing and market share",
  description:
    "Generic medicine expenditure, units dispensed and market shares by health region, latest thirty-six reporting months. Market shares are source fractions (0 to 1), despite percent annotations in the portal; no scaling is inferred.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
};
