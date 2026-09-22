import type { DatasetDefinition } from "#/catalog/define";
import { mafraFeed } from "#/publishers/cm-mafra/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Mafra heritage inventory",
  description: "The municipal heritage inventory of Mafra: each item's designation, address, period, category and the situation it is in.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["cities", "culture"],
  feeds: [mafraFeed({ slug: "mafra-patrimonio-inventario-feed", service: "DadosAbertos_Cult_Patrimonio_Inventario_Total", layer: "0" })],
};
