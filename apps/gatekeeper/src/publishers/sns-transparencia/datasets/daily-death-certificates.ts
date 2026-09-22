import type { DatasetDefinition } from "../../../catalog/define";
import { snsDaily } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Daily death certificates",
  description: "Death certificates issued each day in Portugal, published by DGS.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  feeds: [snsDaily("sns-daily-death-certificates-feed", "evolucao-diaria-de-certificados-de-obito", "data_de_certificacao DESC", "1000", "no_de_certificados_de_obito_diarios")],
};
