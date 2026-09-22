import type { DatasetDefinition } from "#/catalog/define";
import { lisbonFeed } from "#/publishers/cm-lisboa/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Lisboa dog parks",
  description: "Boundaries and public information for dog parks in Lisboa.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  feeds: [lisbonFeed({ slug: "lisboa-parques-caninos-feed", service: "ParquesCaninos", layer: "0" })],
};
