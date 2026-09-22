import type { DatasetDefinition } from "#/catalog/define";
import { lnegFeed } from "#/publishers/lneg/ogc";

export const DATASET: DatasetDefinition = {
  title: "Aquifer systems",
  description:
    "The 63 aquifer systems of Portugal as LNEG delimits them, with their outlines, the national code each carries, the geological age of the rock that holds the water and the hydrogeological unit each belongs to.",
  licence: "cc-by-4.0",
  attribution: "Laboratório Nacional de Energia e Geologia",
  topics: ["environment"],
  feeds: [
    lnegFeed({
      slug: "lneg-sistemas-aquiferos-feed",
      collection: "recursoshidro-sistemas-aqu-feros",
      features: 63,
      measured: { source: 2, output: 2, largestRow: 219 },
    }),
  ],
};
