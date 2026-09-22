import type { DatasetDefinition } from "#/catalog/define";
import { mafraFeed } from "#/publishers/cm-mafra/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Mafra parking areas",
  description: "Parking areas in Mafra with their designation, the number of spaces each holds, whether those spaces are charged for, the address and the parish.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["cities", "mobility"],
  feeds: [mafraFeed({ slug: "mafra-parques-estacionamento-feed", service: "DadosAbertos_Transito_Parques_Estacionamento", layer: "0" })],
};
