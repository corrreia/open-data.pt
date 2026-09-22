import type { DatasetDefinition } from "#/catalog/define";
import { selectedSeries } from "#/publishers/banco-de-portugal/bpstat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Regional, local government and social-security deposits",
  description:
    "Monthly deposit assets held by regional government, local government and social-security funds in Portugal, in millions of euros. Latest sixty observations; these are deposit assets, not public-debt liabilities.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  feeds: [selectedSeries("bpstat-government-deposit-assets", "28", "10470e6b60c710218dd2a0e6a20fb040", [13168814, 13168815, 13168816], 60)],
};
