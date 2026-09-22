import type { DatasetDefinition } from "../../../catalog/define";
import { aguedaFeed } from "../ckan";

export const DATASET: DatasetDefinition = {
  title: "Águeda municipal waste-bin locations",
  description: "Municipal solid-waste container location inventory. No live bin fullness is provided.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Águeda via dadosabertos.cm-agueda.pt",
  topics: ["cities", "environment"],
  feeds: [aguedaFeed("waste-bins", "contentores-rsu", "5ec1ab1d-998b-41f5-b35d-860d63ec869c", { idField: "id", crs: "EPSG:3763" })],
};
