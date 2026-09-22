import type { DatasetDefinition } from "../../../catalog/define";
import { lnegFeed } from "../ogc";

export const DATASET: DatasetDefinition = {
  title: "Mineral occurrences in Portugal",
  description:
    "The 5,483 mineral occurrences in LNEG's national inventory: where each one is, what it holds, its geological description, its size, and how it rates for economic and development potential.",
  licence: "cc-by-4.0",
  attribution: "Laboratório Nacional de Energia e Geologia",
  topics: ["economy", "environment"],
  feeds: [
    lnegFeed({
      slug: "lneg-ocorrencias-minerais-feed",
      collection: "siorminp-mineral-occurrences",
      features: 5483,
      measured: { source: 4, output: 4, largestRow: 3 },
    }),
  ],
};
