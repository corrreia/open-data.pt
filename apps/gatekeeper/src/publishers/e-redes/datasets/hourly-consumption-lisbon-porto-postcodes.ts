import type { DatasetDefinition } from "../../../catalog/define";
import { MONTH } from "../../../formats/opendatasoft/feeds";
import { energy } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Historical hourly electricity consumption in postal areas 1000 and 4000",
  description:
    "Source-reported hourly consumption for four-digit postal areas 1000 (Lisbon) and 4000 (Porto), latest 168 source reporting hours. A fixed two-area comparison, not national consumption or a claim of real-time freshness.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    energy(
      "e-redes-hourly-consumption-lisbon-porto-postcodes-feed",
      {
        dataset: "consumos_horario_codigo_postal",
        timeField: "datahora",
        period: "hour",
        windowPeriods: "168",
        where: "codigo_postal IN ('1000','4000')",
        select: "datahora,codigo_postal,consumo",
        orderBy: "datahora DESC,codigo_postal",
        dimensions: "codigo_postal",
        series: "consumo",
        units: "consumo=kWh",
        limit: "1000",
      },
      MONTH,
    ),
  ],
};
