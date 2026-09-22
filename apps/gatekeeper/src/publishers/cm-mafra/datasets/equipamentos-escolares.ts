import type { DatasetDefinition } from "../../../catalog/define";
import { mafraFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Mafra schools",
  description: "Schools in Mafra with their address, parish, contacts, typology, capacity, opening hours and the grouping each belongs to.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["cities", "society"],
  feeds: [mafraFeed({ slug: "mafra-equipamentos-escolares-feed", service: "DadosAbertos_Educa_Equip_Escolares", layer: "0" })],
};
