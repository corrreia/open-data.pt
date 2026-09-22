import type { DatasetDefinition } from "#/catalog/define";
import { mafraFeed } from "#/publishers/cm-mafra/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Mafra dog parks",
  description: "Dog parks in Mafra with their address, the equipment and drinking fountains they hold, the year each was built, who built and maintains it, and its paving.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["cities", "society"],
  feeds: [mafraFeed({ slug: "mafra-parques-caninos-feed", service: "DadosAbertos_Amb_Parques_Caninos", layer: "0" })],
};
