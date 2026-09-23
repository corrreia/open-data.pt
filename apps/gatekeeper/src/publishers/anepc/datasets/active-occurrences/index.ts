import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Active civil-protection occurrences in mainland Portugal",
  description:
    "Active ANEPC protection-and-relief operations, including accidents and fires, with source status, classification, location and responding resources. This is an operational snapshot, not an emergency alert service; call 112 in an emergency.",
  licence: "sgifr-terms",
  attribution: "ANEPC through ©SIFOR — Sistema de Informação de Fogos Rurais (https://www.sgifr.gov.pt)",
  topics: ["environment", "health", "society"],
};
