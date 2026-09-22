import type { DatasetDefinition } from "../../../catalog/define";
import { energy } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Active electricity contracts by meter type and district",
  description:
    "Active delivery-point contracts with and without smart meters, summed by E-REDES from parish rows into district totals. All districts in its service area, latest twelve reporting months; inactive contracts excluded.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    energy("e-redes-active-smart-meter-contracts-feed", {
      dataset: "21-contadores-de-energia",
      timeField: "data",
      period: "month",
      windowPeriods: "12",
      where: "contrato_ativo = 'Sim'",
      select: "data,coddistrito,distrito,inclui_emi,sum(cpes) as cpes",
      groupBy: "data,coddistrito,distrito,inclui_emi",
      orderBy: "data DESC,coddistrito,distrito,inclui_emi",
      dimensions: "coddistrito,distrito,inclui_emi",
      series: "cpes",
      units: "cpes=delivery points",
    }),
  ],
};
