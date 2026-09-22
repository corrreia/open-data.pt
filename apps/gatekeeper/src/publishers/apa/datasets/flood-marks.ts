import type { DatasetDefinition } from "#/catalog/define";
import { apaFeed } from "#/publishers/apa/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Portugal historical flood marks",
  description: "Locations, dates, recorded flood elevations, and sources for historical flood marks.",
  licence: "cc-by-4.0",
  attribution: "Agência Portuguesa do Ambiente — SNIAmb",
  topics: ["environment"],
  feeds: [apaFeed({ slug: "apa-flood-marks-feed", service: "Marcas_cheias" })],
};
