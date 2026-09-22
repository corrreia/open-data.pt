import type { DatasetDefinition } from "#/catalog/define";
import { energy } from "#/publishers/e-redes/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Energy exported by self-consumption installations",
  description:
    "Monthly energy injected by self-consumption installations, summed by E-REDES into municipality and voltage-level totals for the latest six reporting months. Does not repeat the existing installation-count products.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    energy("e-redes-self-consumption-exported-energy-feed", {
      dataset: "energia_injectada_upac",
      timeField: "data",
      period: "month",
      windowPeriods: "6",
      select: "data,codigo_concelho,con_name,nivel_tensao,sum(energia) as energia",
      groupBy: "data,codigo_concelho,con_name,nivel_tensao",
      orderBy: "data DESC,codigo_concelho,con_name,nivel_tensao",
      dimensions: "codigo_concelho,con_name,nivel_tensao",
      series: "energia",
      units: "energia=kWh",
    }),
  ],
};
