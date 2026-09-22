import type { DatasetDefinition } from "#/catalog/define";
import { MONTH } from "#/formats/opendatasoft/feeds";
import { energy } from "#/publishers/e-redes/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Public street lighting by municipality and lamp type",
  description:
    "E-REDES public-lighting counts and installed power, summed by the source from parish aggregates into municipality and lamp-type totals. The reporting clock is the published year and month, not collection time; this is not a map of individual lamps.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    energy(
      "e-redes-municipal-street-lighting-feed",
      {
        dataset: "cadastro_iluminacao_publica",
        timeField: "ano",
        monthField: "mes",
        select: "ano,mes,coddistritoconcelho,tipo_de_lampada,sum(luminarias) as luminarias,sum(lampadas) as lampadas,sum(potencia_instalada_total) as potencia_instalada_total",
        groupBy: "ano,mes,coddistritoconcelho,tipo_de_lampada",
        orderBy: "ano DESC,mes DESC,coddistritoconcelho,tipo_de_lampada",
        dimensions: "coddistritoconcelho,tipo_de_lampada",
        series: "luminarias,lampadas,potencia_instalada_total",
        units: "luminarias=luminaires,lampadas=lamps,potencia_instalada_total=W",
      },
      MONTH,
    ),
  ],
};
