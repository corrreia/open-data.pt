import type { DatasetDefinition } from "../../../catalog/define";
import { LISBON_UNSTATED_POLICY, lisbonFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Lisbon micromobility parking restriction zones",
  description: "Areas in Lisbon where authorised micromobility operators may not leave vehicles parked.",
  licence: "source-terms",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  feeds: [lisbonFeed({ slug: "lisbon-micromobility-restrictions-feed", service: "MOB_Micromobilidade", layer: "0", policy: LISBON_UNSTATED_POLICY })],
};
