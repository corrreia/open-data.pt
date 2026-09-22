import type { DatasetDefinition } from "#/catalog/define";
import { energy } from "#/publishers/e-redes/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Monthly electricity consumption by municipality and voltage",
  description:
    "E-REDES billed active energy, summed by the source from parish rows into municipality and voltage-level totals. All published municipalities, latest twelve reporting months; Includes source-suppressed OUTROS district groups rather than attributing them to a municipality; not island consumption outside E-REDES coverage.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    energy("e-redes-municipal-monthly-consumption-feed", {
      dataset: "3-consumos-faturados-por-municipio-ultimos-10-anos",
      timeField: "data",
      period: "month",
      windowPeriods: "12",
      select: "data,coddistritoconcelho,concelho,nivel_de_tensao,sum(energia_ativa_kwh) as energia_ativa_kwh",
      groupBy: "data,coddistritoconcelho,concelho,nivel_de_tensao",
      orderBy: "data DESC,coddistritoconcelho,concelho,nivel_de_tensao",
      dimensions: "coddistritoconcelho,concelho,nivel_de_tensao",
      series: "energia_ativa_kwh",
      units: "energia_ativa_kwh=kWh",
    }),
  ],
};
