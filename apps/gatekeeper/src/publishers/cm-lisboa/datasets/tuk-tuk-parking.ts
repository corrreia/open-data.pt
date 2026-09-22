import type { DatasetDefinition } from "../../../catalog/define";
import { lisbonFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Lisbon tuk-tuk parking areas",
  description: "Designated tuk-tuk parking locations in Lisbon.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  feeds: [lisbonFeed({ slug: "lisbon-tuk-tuk-parking-feed", service: "TukTukEstacionamentos", layer: "0" })],
};
