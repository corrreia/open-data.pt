import type { DatasetDefinition } from "../../../catalog/define";
import { LISBON_UNSTATED_POLICY, lisbonFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Lisbon libraries and archives",
  description: "Locations, contacts, and public information for libraries, archives, and documentation centres in Lisbon.",
  licence: "source-terms",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  feeds: [lisbonFeed({ slug: "lisbon-libraries-archives-feed", service: "EquipamentosCulturais", layer: "1", policy: LISBON_UNSTATED_POLICY })],
};
