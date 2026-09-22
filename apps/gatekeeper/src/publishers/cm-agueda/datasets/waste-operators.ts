import type { DatasetDefinition } from "../../../catalog/define";
import { aguedaFeed } from "../ckan";

export const DATASET: DatasetDefinition = {
  title: "Águeda waste-management operators",
  description: "Reference locations and published details of waste-management establishments.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Águeda via dadosabertos.cm-agueda.pt",
  topics: ["cities", "environment"],
  feeds: [aguedaFeed("waste-operators", "b2d1563d-683f-4dff-a472-a68789c9df74", "4a836cd0-eed9-4ecd-b9fc-ebeee1323aae", { idField: "id_ogr" })],
};
