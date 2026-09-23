import type { DatasetDefinition } from "#/catalog/define";

// No Lisbon-district feed: its 37 stations are already in dgeg-gasolina-98, which covers the whole mainland.
export const DATASET: DatasetDefinition = {
  title: "DGEG fuel prices",
  description: "What each mainland fuel station charges, by fuel type, as reported to DGEG.",
  licence: "dgeg-precos-terms",
  attribution: "Direção-Geral de Energia e Geologia",
  topics: ["energy"],
};
