import type { DatasetDefinition } from "#/catalog/define";
import { DAILY_STATISTICS } from "#/publishers/banco-de-portugal/bpstat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Population, employment and unemployment indicators",
  description: "Population, unemployment benefit, job application, vacancy, and placement indicators for Portugal.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  feeds: [
    {
      slug: "bpstat-employment-and-unemployment",
      config: {
        source: "bpstat",
        domain: "13",
        dataset: "b8cc662879c9f7b0f3faf89c7871fc38",
        lang: "EN",
      },
      policy: DAILY_STATISTICS,
      staleAfterSeconds: 7 * 86_400,
    },
  ],
};
