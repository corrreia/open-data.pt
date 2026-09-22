import type { DatasetDefinition } from "../../../catalog/define";
import { aguedaFeed } from "../ckan";

export const DATASET: DatasetDefinition = {
  title: "Águeda electronics collection-bin locations",
  description: "Electrical and electronic waste collection points, not live capacity or fullness.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Águeda via dadosabertos.cm-agueda.pt",
  topics: ["cities", "environment"],
  feeds: [aguedaFeed("electronics-bins", "contentores-reee", "a7963739-44fd-47ec-b9bf-481141cfcda5", { idField: "id", crs: "EPSG:3763" })],
};
