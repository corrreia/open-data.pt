import type { DatasetDefinition } from "#/catalog/define";
import { lisbonFeed } from "#/publishers/cm-lisboa/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Lisbon reported tree incidents",
  description: "Locations and current details for tree incidents published by Lisbon municipality.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  feeds: [lisbonFeed({ slug: "lisbon-tree-incidents-feed", service: "Incidentes_Arv", layer: "0" })],
};
