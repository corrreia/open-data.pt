import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Portuguese Treasury-bond yields",
  description:
    "Daily fixed-rate Portuguese Treasury-bond yields for residual maturities of two, three, four, five, seven and ten years. Latest 366 observations per maturity; excludes monthly repetitions and German/US yields.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
};
