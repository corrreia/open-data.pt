import type { DatasetDefinition } from "../../../catalog/define";
import { mafraFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Mafra beaches",
  description: "Beaches in Mafra and the distinctions each holds: Blue Flag, accessible beach, healthy beach, gold quality, zero pollution and surf reserve.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["environment", "society"],
  feeds: [mafraFeed({ slug: "mafra-praias-feed", service: "DadosAbertos_Tur_Praias", layer: "0" })],
};
