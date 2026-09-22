import type { DatasetDefinition } from "../../../catalog/define";
import { LISBON_UNSTATED_POLICY, lisbonFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Lisbon parish boundaries",
  description: "Boundaries and identifiers for the 24 civil parishes of Lisbon.",
  licence: "source-terms",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  feeds: [lisbonFeed({ slug: "lisbon-parishes-feed", service: "Base_Freguesias", layer: "0", policy: LISBON_UNSTATED_POLICY })],
};
