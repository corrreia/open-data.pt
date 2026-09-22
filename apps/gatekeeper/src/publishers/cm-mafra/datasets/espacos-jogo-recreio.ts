import type { DatasetDefinition } from "#/catalog/define";
import { mafraFeed } from "#/publishers/cm-mafra/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Mafra play areas",
  description: "Play and recreation areas in Mafra with their name, address, locality, parish and type.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["cities", "society"],
  feeds: [mafraFeed({ slug: "mafra-espacos-jogo-recreio-feed", service: "DadosAbertos_Equip_Esp_Jogo_Recreio", layer: "0" })],
};
