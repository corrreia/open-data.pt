import type { DatasetDefinition } from "../../../catalog/define";
import { apaFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Portugal air quality monitoring stations",
  description: "Locations and site details for stations in the national air-quality monitoring network.",
  licence: "cc-by-4.0",
  attribution: "Agência Portuguesa do Ambiente — SNIAmb",
  topics: ["environment"],
  feeds: [apaFeed({ slug: "apa-air-quality-stations-feed", service: "Qualidade_do_Ar" })],
};
