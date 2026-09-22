import type { DatasetDefinition } from "#/catalog/define";
import { mafraFeed } from "#/publishers/cm-mafra/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Mafra walking and mountain-bike trails",
  description: "Walking and mountain-bike trails in Mafra with their name, description and type.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["environment", "society"],
  feeds: [mafraFeed({ slug: "mafra-circuitos-pedestres-btt-feed", service: "DadosAbertos_Desp_CircuitosPedestres_BTT", layer: "0" })],
};
