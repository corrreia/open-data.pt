import type { DatasetDefinition } from "#/catalog/define";
import { mafraFeed } from "#/publishers/cm-mafra/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Mafra bicycle parking",
  description: "Bicycle parking in Mafra with its location, parish and the observations recorded for it.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["cities", "mobility"],
  feeds: [mafraFeed({ slug: "mafra-estacionamento-bicicletas-feed", service: "DadosAbertos_Transito_Estacionamento_Bicicletas", layer: "0" })],
};
