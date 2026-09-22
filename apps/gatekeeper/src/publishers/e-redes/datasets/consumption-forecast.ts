import type { DatasetDefinition } from "#/catalog/define";
import { E_REDES_QUARTER_HOUR_SERIES, eRedes } from "#/publishers/e-redes/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Electricity consumption forecast",
  description: "E-REDES 15-minute consumption forecast by voltage level, from the past day to seven days ahead.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    eRedes(
      "e-redes-consumption-forecast-feed",
      {
        portalDataset: "previsao-de-consumo",
        where: "datahora >= now(days=-1) AND datahora < now(days=8)",
        orderBy: "datahora",
        limit: "1000",
        series: "total,bt,mt,at,mat",
      },
      E_REDES_QUARTER_HOUR_SERIES,
      172_800,
    ),
  ],
};
