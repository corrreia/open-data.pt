import type { DatasetDefinition } from "../../../catalog/define";
import { aguedaFeed } from "../ckan";

export const DATASET: DatasetDefinition = {
  title: "Águeda textile collection-bin locations",
  description: "Textile recycling container location inventory, not live capacity or fullness.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Águeda via dadosabertos.cm-agueda.pt",
  topics: ["cities", "environment"],
  feeds: [aguedaFeed("textile-bins", "f2f9d71f-ffab-4678-b4a1-6a2709879020", "df073fc9-441e-4385-b50e-0290881a5729", { idField: "id", crs: "EPSG:3763" })],
};
