import type { DatasetDefinition } from "#/catalog/define";
import { lnegFeed } from "#/publishers/lneg/ogc";

export const DATASET: DatasetDefinition = {
  title: "Geological faults at 1:1,000,000",
  description: "The 297 faults of the harmonised 1:1,000,000 geological map of Portugal, each with the kind of fault it is and the vocabulary term LNEG classifies it under.",
  licence: "cc-by-4.0",
  attribution: "Laboratório Nacional de Energia e Geologia",
  topics: ["environment"],
  feeds: [
    lnegFeed({
      slug: "lneg-falhas-geologicas-feed",
      collection: "cgp1m-ge-geologicfault",
      features: 297,
      measured: { source: 1, output: 1, largestRow: 10 },
    }),
  ],
};
