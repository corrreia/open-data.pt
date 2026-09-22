import type { DatasetDefinition } from "#/catalog/define";
import { apaFeed } from "#/publishers/apa/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Portugal bathing waters",
  description: "Identified coastal and inland bathing waters, with their classification and location.",
  licence: "cc-by-4.0",
  attribution: "Agência Portuguesa do Ambiente — SNIAmb",
  topics: ["environment"],
  feeds: [apaFeed({ slug: "apa-bathing-waters-feed", service: "Aguas_Balneares" })],
};
