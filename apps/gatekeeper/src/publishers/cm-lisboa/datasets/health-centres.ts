import type { DatasetDefinition } from "../../../catalog/define";
import { lisbonFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Lisbon health centres",
  description: "Locations and contact details for public health centres in Lisbon.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  feeds: [
    /*
     * The health-centre dataset is read by three feeds — centres, pharmacies and
     * hospitals are three layers of one service, keyed and served alike — so each
     * says what it is within it.
     */
    lisbonFeed({
      slug: "lisbon-health-centres-feed",
      title: "Lisbon health centres",
      description: "Locations and contact details for public health centres in Lisbon.",
      service: "POISaude",
      layer: "0",
    }),
    lisbonFeed({
      slug: "lisbon-pharmacies-feed",
      title: "Lisbon pharmacies",
      description: "Locations and contact details for pharmacies in Lisbon.",
      service: "POISaude",
      layer: "1",
    }),
    lisbonFeed({
      slug: "lisbon-public-hospitals-feed",
      title: "Lisbon public hospitals",
      description: "Locations and contact details for public hospitals in Lisbon.",
      service: "POISaude",
      layer: "4",
    }),
  ],
};
