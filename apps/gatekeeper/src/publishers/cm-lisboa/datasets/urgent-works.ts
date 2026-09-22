import type { DatasetDefinition } from "../../../catalog/define";
import { LISBON_UNSTATED_POLICY, lisbonFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Lisbon urgent public works",
  description: "Locations of urgent public works carried out by Lisbon municipality.",
  licence: "source-terms",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  feeds: [lisbonFeed({ slug: "lisbon-urgent-works-feed", service: "DCIEP_OBRAS_25_gdb", layer: "1", policy: LISBON_UNSTATED_POLICY })],
};
