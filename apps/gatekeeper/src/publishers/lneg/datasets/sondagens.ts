import type { DatasetDefinition } from "#/catalog/define";
import { lnegFeed } from "#/publishers/lneg/ogc";

export const DATASET: DatasetDefinition = {
  title: "Boreholes in the national database",
  description: "The 3,497 boreholes in LNEG's SondaBase: where each was drilled, its name, its length, the elevation it started from and the direction it took.",
  licence: "cc-by-4.0",
  attribution: "Laboratório Nacional de Energia e Geologia",
  topics: ["economy", "environment"],
  feeds: [
    lnegFeed({
      slug: "lneg-sondagens-feed",
      collection: "sondabase-sondagem",
      features: 3497,
      measured: { source: 1, output: 1, largestRow: 1 },
    }),
  ],
};
