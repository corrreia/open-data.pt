import type { DatasetDefinition } from "#/catalog/define";
import { mafraFeed } from "#/publishers/cm-mafra/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Mafra electric-vehicle charging points",
  description:
    "Charging points in Mafra with their operator, the kind of charge and number of chargers, the form of operation, and the licence and contract periods each runs under.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["energy", "mobility"],
  feeds: [mafraFeed({ slug: "mafra-postos-carregamento-feed", service: "DadosAbertos_Postos_Carregamento_Eletrico", layer: "0" })],
};
