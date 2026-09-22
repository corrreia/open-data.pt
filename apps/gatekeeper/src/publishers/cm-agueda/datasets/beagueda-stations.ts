import type { DatasetDefinition } from "#/catalog/define";
import { aguedaFeed } from "#/publishers/cm-agueda/ckan";

export const DATASET: DatasetDefinition = {
  title: "beÁgueda bicycle station locations",
  description: "Reference locations and dock capacities of beÁgueda bicycle stations, not live bicycle or dock availability.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Águeda via dadosabertos.cm-agueda.pt",
  topics: ["cities", "mobility"],
  feeds: [aguedaFeed("beagueda-stations", "estacoes-beagueda", "c6da7509-f4b1-4a3c-a39b-5af5e4908288", { idField: "id" })],
};
