import type { DatasetDefinition } from "../../../catalog/define";
import { mafraFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Mafra cultural facilities",
  description: "Cultural bodies and facilities in Mafra with their typology, category, name and location.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["cities", "culture"],
  feeds: [mafraFeed({ slug: "mafra-equipamentos-cultura-feed", service: "DadosAbertos_Equipamentos_Coletivos_Cultura", layer: "0" })],
};
