import type { DatasetDefinition } from "#/catalog/define";
import { apaFeed } from "#/publishers/apa/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Portugal RADNET radiation monitoring stations",
  description: "Locations and site details for the national airborne radioactivity alert network.",
  licence: "cc-by-4.0",
  attribution: "Agência Portuguesa do Ambiente — SNIAmb",
  topics: ["environment"],
  feeds: [apaFeed({ slug: "apa-radnet-stations-feed", service: "RADNET" })],
};
