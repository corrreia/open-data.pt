import type { DatasetDefinition } from "#/catalog/define";
import { aguedaFeed } from "#/publishers/cm-agueda/ckan";

export const DATASET: DatasetDefinition = {
  title: "Águeda electric-vehicle charging locations",
  description: "Published charging-point location inventory and technical details. This is not live charging availability.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Águeda via dadosabertos.cm-agueda.pt",
  topics: ["cities", "energy", "mobility"],
  feeds: [aguedaFeed("charging-locations", "ponto-de-carregamento-de-veiculos-eletricos", "8a0e420f-ebe4-452c-956f-870427811bcd", { idField: "id_pontocve" })],
};
