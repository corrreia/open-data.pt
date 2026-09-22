import type { DatasetDefinition } from "../../../catalog/define";
import { lisbonFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Lisbon PSP police stations",
  description: "Locations and contact details for Public Security Police stations in Lisbon.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  feeds: [lisbonFeed({ slug: "lisbon-psp-police-stations-feed", service: "POISeguranca", layer: "1" })],
};
