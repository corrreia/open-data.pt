import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Active electricity contracts by meter type and district",
  description:
    "Active delivery-point contracts with and without smart meters, summed by E-REDES from parish rows into district totals. All districts in its service area, latest twelve reporting months; inactive contracts excluded.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
};
