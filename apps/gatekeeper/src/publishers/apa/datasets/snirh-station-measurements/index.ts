import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "SNIRH station measurements",
  description: "What APA's monitoring network measures at each station: river levels and flows, reservoir levels and storage, groundwater levels, and hourly weather.",
  licence: "snirh-terms",
  attribution: "SNIRH — Sistema Nacional de Informação de Recursos Hídricos, APA",
  topics: ["environment", "weather"],
};
