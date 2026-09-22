import type { DatasetDefinition } from "#/catalog/define";
import { cascaisFeed } from "#/publishers/cm-cascais/ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais bus stops",
  description: "Bus stops in Cascais with their location and shelter details.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "mobility"],
  feeds: [cascaisFeed("cascais-bus-stops-feed", "geocascais-paragemautocarro", "a5375dc1-824a-48ec-b7e3-8030d5543285")],
};
