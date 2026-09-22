import type { DatasetDefinition } from "../../../catalog/define";
import { lisbonFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Lisboa playgrounds",
  description: "Locations and management details for playgrounds in Lisboa.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  feeds: [lisbonFeed({ slug: "lisboa-parques-infantis-feed", service: "POIArLivre", layer: "2" })],
};
