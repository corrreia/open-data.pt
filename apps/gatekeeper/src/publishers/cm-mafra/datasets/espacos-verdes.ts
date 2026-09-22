import type { DatasetDefinition } from "#/catalog/define";
import { mafraFeed } from "#/publishers/cm-mafra/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Mafra green spaces",
  description: "Green spaces in Mafra with their code, the place and locality they lie in, the space they belong to, and the parish.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["cities", "environment"],
  feeds: [mafraFeed({ slug: "mafra-espacos-verdes-feed", service: "DadosAbertos_Amb_Espacos_Verdes", layer: "3" })],
};
