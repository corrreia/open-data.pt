import type { DatasetDefinition } from "../../../catalog/define";
import { lisbonFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Lisbon fire stations",
  description: "Locations of fire brigade stations in Lisbon.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  feeds: [lisbonFeed({ slug: "lisbon-fire-stations-feed", service: "POISocorro", layer: "1" })],
};
