import type { DatasetDefinition } from "../../../catalog/define";
import { apaFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Establishments under major-accident prevention rules",
  description: "Industrial sites covered by the Seveso major-accident prevention regime (Decree-Law 150/2015).",
  licence: "cc-by-4.0",
  attribution: "Agência Portuguesa do Ambiente — SNIAmb",
  topics: ["environment"],
  feeds: [apaFeed({ slug: "apa-seveso-establishments-feed", service: "Prevencao_Acidentes_Graves" })],
};
