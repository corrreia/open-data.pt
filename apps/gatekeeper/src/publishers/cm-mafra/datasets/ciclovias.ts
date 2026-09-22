import type { DatasetDefinition } from "#/catalog/define";
import { mafraFeed } from "#/publishers/cm-mafra/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Mafra cycle lanes",
  description: "Cycle lanes in Mafra with their name, typology, and whether each is a principal route.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["cities", "mobility"],
  feeds: [mafraFeed({ slug: "mafra-ciclovias-feed", service: "DadosAbertos_Desp_Ciclovias", layer: "0" })],
};
