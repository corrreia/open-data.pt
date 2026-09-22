import type { DatasetDefinition } from "#/catalog/define";
import { mafraFeed } from "#/publishers/cm-mafra/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Mafra parking meters",
  description: "Parking meters in Mafra with the hours they apply on weekdays, Saturdays and Sundays, the tariff, and the least and greatest amount each takes.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["cities", "mobility"],
  feeds: [mafraFeed({ slug: "mafra-parcometros-feed", service: "DadosAbertos_Transito_Parcometros", layer: "0" })],
};
