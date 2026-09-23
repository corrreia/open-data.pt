import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Municipal electricity consumption by tariff period",
  description:
    "Billed active energy in the source's six tariff-period categories, summed across parishes for every E-REDES municipality, latest six reporting months. The overall energy total is not repeated.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
};
