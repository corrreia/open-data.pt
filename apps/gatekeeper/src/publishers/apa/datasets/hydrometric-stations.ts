import type { DatasetDefinition } from "#/catalog/define";
import { apaFeed } from "#/publishers/apa/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Portugal hydrometric stations",
  description: "Locations, operating status, station type, and public data links for hydrometric stations.",
  licence: "cc-by-4.0",
  attribution: "Agência Portuguesa do Ambiente — SNIAmb",
  topics: ["environment"],
  feeds: [apaFeed({ slug: "apa-hydrometric-stations-feed", service: "Estacoes_hidrometricas" })],
};
