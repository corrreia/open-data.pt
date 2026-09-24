import { defineFeed } from "#/catalog/define";
import { E_REDES_HOST, E_REDES_MONTHLY_PERIODS } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-service-continuity-feed",
  title: "Electricity service continuity by municipality",
  description:
    "Annual SAIFI, SAIDI, MAIFI, TIEPI and energy-not-distributed indicators for all E-REDES municipalities, municipality-wide RQS zone only, in the latest three reporting years. These are reliability statistics, not live outages.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  config: {
    host: E_REDES_HOST,
    limit: "10000",
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
  policy: E_REDES_MONTHLY_PERIODS,
  staleAfterSeconds: 5_184_000,
  /** Once a month: the latest 3 years of E-REDES's `12-continuidade-de-servico-indicadores-gerais-de-continuidade-de-servico` dataset, by `ano`, filtered at the source. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `12-continuidade-de-servico-indicadores-gerais-de-continuidade-de-servico` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of its 10 measures. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
