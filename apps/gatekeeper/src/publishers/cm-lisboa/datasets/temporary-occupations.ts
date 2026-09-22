import type { DatasetDefinition } from "#/catalog/define";
import { LISBON_UNSTATED_POLICY, lisbonFeed } from "#/publishers/cm-lisboa/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Lisbon licensed temporary use of public space",
  description: "Licensed events and temporary occupations of public space in Lisbon, with dates and parish.",
  licence: "source-terms",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  feeds: [lisbonFeed({ slug: "lisbon-temporary-occupations-feed", service: "UCT_OcupacoesTemporariasEspacoPublico", layer: "0", policy: LISBON_UNSTATED_POLICY })],
};
