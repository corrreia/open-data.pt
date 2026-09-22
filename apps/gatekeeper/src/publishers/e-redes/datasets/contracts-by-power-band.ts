import type { DatasetDefinition } from "#/catalog/define";
import { energy } from "#/publishers/e-redes/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Electricity contracts by district and power band",
  description:
    "Contract counts by district and contracted-power band, aggregated by the source from parish detail. All E-REDES districts, latest twelve reporting months; no arbitrary parish sample.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    energy("e-redes-contracts-by-power-band-feed", {
      dataset: "clientes-por-escalao-de-potencia",
      timeField: "data",
      period: "month",
      windowPeriods: "12",
      select: "data,dis_code,segmento_de_potencia_contratada,sum(numero_de_contratos) as numero_de_contratos",
      groupBy: "data,dis_code,segmento_de_potencia_contratada",
      orderBy: "data DESC,dis_code,segmento_de_potencia_contratada",
      dimensions: "dis_code,segmento_de_potencia_contratada",
      series: "numero_de_contratos",
      units: "numero_de_contratos=contracts",
    }),
  ],
};
