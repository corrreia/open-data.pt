import type { DatasetDefinition } from "../../../catalog/define";
import { lisbonFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Lisbon speed cameras",
  description: "Locations of fixed speed cameras on Lisbon roads.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  feeds: [
    /*
     * The radars and the message panels are two layers of one service, and one
     * dataset: each says which of the two it is.
     */
    lisbonFeed({
      slug: "lisbon-speed-cameras-feed",
      title: "Lisbon speed cameras",
      description: "Locations of fixed speed cameras on Lisbon roads.",
      service: "MOB_RadaresPaineis",
      layer: "0",
    }),
    lisbonFeed({
      slug: "lisbon-variable-message-signs-feed",
      title: "Lisbon variable message signs",
      description: "Locations of electronic road signs that show traffic messages in Lisbon.",
      service: "MOB_RadaresPaineis",
      layer: "1",
    }),
  ],
};
