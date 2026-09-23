import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Electricity contracts by district and power band",
  description:
    "Contract counts by district and contracted-power band, aggregated by the source from parish detail. All E-REDES districts, latest twelve reporting months; no arbitrary parish sample.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
};
