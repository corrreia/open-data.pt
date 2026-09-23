import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Public street lighting by municipality and lamp type",
  description:
    "E-REDES public-lighting counts and installed power, summed by the source from parish aggregates into municipality and lamp-type totals. The reporting clock is the published year and month, not collection time; this is not a map of individual lamps.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
};
