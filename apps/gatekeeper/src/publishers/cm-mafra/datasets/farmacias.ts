import type { DatasetDefinition } from "#/catalog/define";
import { mafraFeed } from "#/publishers/cm-mafra/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Mafra pharmacies",
  description: "Pharmacies in Mafra with their address, parish, contacts, hours of operation and duty shifts.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["cities", "health"],
  feeds: [mafraFeed({ slug: "mafra-farmacias-feed", service: "DadosAbertos_Equip_Farmacias", layer: "1" })],
};
