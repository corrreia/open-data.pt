import type { DatasetDefinition } from "#/catalog/define";
import { MONTH } from "#/formats/opendatasoft/feeds";
import { energy } from "#/publishers/e-redes/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Electricity service continuity by municipality",
  description:
    "Annual SAIFI, SAIDI, MAIFI, TIEPI and energy-not-distributed indicators for all E-REDES municipalities, municipality-wide RQS zone only, in the latest three reporting years. These are reliability statistics, not live outages.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    energy(
      "e-redes-service-continuity-feed",
      {
        dataset: "12-continuidade-de-servico-indicadores-gerais-de-continuidade-de-servico",
        timeField: "ano",
        period: "year",
        windowPeriods: "3",
        where: "zona_rqs = 'Concelho'",
        orderBy: "ano DESC,codigo_concelho,zona_rqs",
        dimensions: "codigo_concelho,zona_rqs",
        series: "saifi_at_num,saidi_at_min,maifi_at_num,tiepi_mt_min,end_mt_mwh,saifi_mt_num,saidi_mt_min,maifi_mt_num,saifi_bt_num,saidi_bt_min",
        units:
          "saifi_at_num=interruptions,saidi_at_min=min,maifi_at_num=interruptions,tiepi_mt_min=min,end_mt_mwh=MWh,saifi_mt_num=interruptions,saidi_mt_min=min,maifi_mt_num=interruptions,saifi_bt_num=interruptions,saidi_bt_min=min",
      },
      MONTH,
    ),
  ],
};
