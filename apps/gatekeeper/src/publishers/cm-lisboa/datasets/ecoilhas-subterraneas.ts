import type { DatasetDefinition } from "../../../catalog/define";
import { lisbonFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Lisboa underground recycling islands",
  description: "Locations and attributes of underground recycling islands in Lisboa.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  feeds: [lisbonFeed({ slug: "lisboa-ecoilhas-subterraneas-feed", service: "Amb_EcopontosSubterraneos", layer: "0" })],
};
