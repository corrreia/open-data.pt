import type { DatasetDefinition } from "../../../catalog/define";
import { lisbonFeed } from "../arcgis";
import { arcgisReferencePolicy } from "../../../formats/arcgis/feeds";

export const DATASET: DatasetDefinition = {
  title: "Lisboa cycling network",
  description: "Cycle-network line segments published by Lisboa Aberta.",
  licence: "cc-by-4.0",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  feeds: [lisbonFeed({ slug: "lisboa-rede-ciclavel-feed", service: "Ciclovias", layer: "0", policy: arcgisReferencePolicy("ArcGIS daily reference layer, attributed") })],
};
