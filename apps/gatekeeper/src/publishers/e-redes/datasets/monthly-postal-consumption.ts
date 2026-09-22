import type { DatasetDefinition } from "#/catalog/define";
import { energy } from "#/publishers/e-redes/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Monthly electricity consumption by four-digit postal area",
  description:
    "Billed active energy for every four-digit postal area published by E-REDES, latest six reporting months. These are postal areas, not seven-digit delivery addresses.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    energy("e-redes-monthly-postal-consumption-feed", {
      dataset: "02-consumos-faturados-por-codigo-postal-ultimos-5-anos",
      timeField: "date",
      period: "month",
      windowPeriods: "6",
      select: "date,codigopostal,energiaativa",
      orderBy: "date DESC,codigopostal",
      dimensions: "codigopostal",
      series: "energiaativa",
      units: "energiaativa=kWh",
    }),
  ],
};
