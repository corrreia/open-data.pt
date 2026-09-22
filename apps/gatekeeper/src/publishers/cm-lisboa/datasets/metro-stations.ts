import type { DatasetDefinition } from "#/catalog/define";
import { lisbonFeed } from "#/publishers/cm-lisboa/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Lisbon metro stations",
  description: "Locations and public information for metro stations in Lisbon.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  feeds: [lisbonFeed({ slug: "lisbon-metro-stations-feed", service: "POITransportes", layer: "1" })],
};
