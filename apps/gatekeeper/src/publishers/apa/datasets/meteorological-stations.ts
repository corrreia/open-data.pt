import type { DatasetDefinition } from "../../../catalog/define";
import { apaFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Portugal meteorological stations",
  description: "Locations, operating status, station type, and public data links for meteorological stations.",
  licence: "cc-by-4.0",
  attribution: "Agência Portuguesa do Ambiente — SNIAmb",
  topics: ["environment"],
  feeds: [apaFeed({ slug: "apa-meteorological-stations-feed", service: "Estacoes_meteorologicas" })],
};
