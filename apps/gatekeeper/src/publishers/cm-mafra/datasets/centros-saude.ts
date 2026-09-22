import type { DatasetDefinition } from "../../../catalog/define";
import { mafraFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Mafra health centres",
  description: "Health centres in Mafra with their address, parish, contacts, hours of operation and service shifts.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["cities", "health"],
  feeds: [mafraFeed({ slug: "mafra-centros-saude-feed", service: "DadosAbertos_Equip_Saude", layer: "1" })],
};
