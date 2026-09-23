import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Emigrant deposits by Portuguese NUTS II region",
  description:
    "Emigrant deposits domiciled in the nine Portuguese NUTS II regions, in millions of euros, latest thirty-six monthly observations. Excludes overlapping NUTS III totals, other depositors and accounts not assigned to a physical branch.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
};
