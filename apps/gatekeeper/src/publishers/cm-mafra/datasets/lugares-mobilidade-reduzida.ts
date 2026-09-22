import type { DatasetDefinition } from "#/catalog/define";
import { mafraFeed } from "#/publishers/cm-mafra/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Mafra reduced-mobility parking bays",
  description: "Parking bays reserved for reduced mobility in Mafra, with the street and traffic codes, the locality and parish, and the date each sign was placed.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["mobility", "society"],
  feeds: [mafraFeed({ slug: "mafra-lugares-mobilidade-reduzida-feed", service: "DadosAbertos_Transito_Lugares_Mobilidade_Reduzida", layer: "0" })],
};
