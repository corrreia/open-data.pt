import type { DatasetDefinition } from "#/catalog/define";
import { E_REDES_QUARTER_HOUR_SERIES, eRedes } from "#/publishers/e-redes/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Energy injected into the distribution network",
  description: "The latest 15-minute energy injected into the distribution network by cogeneration, wind, solar, hydro, and other sources.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    eRedes(
      "e-redes-distribution-injection-feed",
      {
        portalDataset: "energia-injetada-na-rede-de-distribuicao",
        orderBy: "datahora DESC",
        limit: "1000",
        series: "rede_dist,cogeracao,eolica,fotovoltaica,hidrica,outras_tecnologias",
      },
      E_REDES_QUARTER_HOUR_SERIES,
      172_800,
    ),
  ],
};
