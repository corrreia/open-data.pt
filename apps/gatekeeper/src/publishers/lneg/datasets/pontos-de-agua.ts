import type { DatasetDefinition } from "../../../catalog/define";
import { lnegFeed } from "../ogc";

export const DATASET: DatasetDefinition = {
  title: "Groundwater points",
  description:
    "The 5,399 water points in LNEG's groundwater inventory: where each is, the district it lies in, its elevation, what kind of point it is, what it is used for and what it was surveyed for.",
  licence: "cc-by-4.0",
  attribution: "Laboratório Nacional de Energia e Geologia",
  topics: ["environment"],
  feeds: [
    lnegFeed({
      slug: "lneg-pontos-de-agua-feed",
      collection: "recursoshidro-pontos-de-gua",
      features: 5399,
      measured: { source: 2, output: 2, largestRow: 1 },
    }),
  ],
};
