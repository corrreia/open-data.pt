import type { DatasetDefinition } from "../../../catalog/define";
import { LISBON_UNSTATED_POLICY, lisbonFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Lisbon recycling points",
  description: "Locations and collection details for public recycling points in Lisbon.",
  licence: "source-terms",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  feeds: [lisbonFeed({ slug: "lisbon-recycling-points-feed", service: "Amb_Reciclagem", layer: "2", policy: LISBON_UNSTATED_POLICY })],
};
