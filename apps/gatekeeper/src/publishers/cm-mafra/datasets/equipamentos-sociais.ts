import type { DatasetDefinition } from "../../../catalog/define";
import { mafraFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Mafra social facilities",
  description: "Social facilities in Mafra with their address and parish, their legal nature, the services each offers and the capacity it holds.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["cities", "society"],
  feeds: [mafraFeed({ slug: "mafra-equipamentos-sociais-feed", service: "DadosAbertos_ASocial_Equipamentos_Sociais", layer: "1" })],
};
