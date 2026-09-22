import type { DatasetDefinition } from "#/catalog/define";
import { energy } from "#/publishers/e-redes/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Contracted electricity capacity by municipality",
  description: "Contracted capacity summed by the source from parish rows for every E-REDES municipality, latest twelve reporting months. Contract counts are not repeated here.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    energy("e-redes-municipal-contracted-capacity-feed", {
      dataset: "potencia-contratada-contratos-ativos-municipio",
      timeField: "data",
      period: "month",
      windowPeriods: "12",
      select: "data,con_code,con_name,sum(potencia_contratada) as potencia_contratada",
      groupBy: "data,con_code,con_name",
      orderBy: "data DESC,con_code,con_name",
      dimensions: "con_code,con_name",
      series: "potencia_contratada",
      units: "potencia_contratada=kVA",
    }),
  ],
};
