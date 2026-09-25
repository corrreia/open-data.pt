import { defineFeed } from "#/catalog/define";
import { E_REDES_HOST, E_REDES_MONTHLY_PERIODS } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-hourly-consumption-lisbon-porto-postcodes-feed",
  title: "Historical hourly electricity consumption in postal areas 1000 and 4000",
  description:
    "Source-reported hourly consumption for four-digit postal areas 1000 (Lisbon) and 4000 (Porto), latest 168 source reporting hours. A fixed two-area comparison, not national consumption or a claim of real-time freshness.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  config: {
    host: E_REDES_HOST,
    limit: "1000",
    dataset: "consumos_horario_codigo_postal",
    timeField: "datahora",
    period: "hour",
    windowPeriods: "168",
    // Where the clocks went forward on 26 March 2023, the export carries a row for 01:00, an hour Lisbon skipped, beside
    // the real 02:00 one at the same instant: about a quarter of that hour, so a stray quarter-hour, not an hour of its own.
    where: "codigo_postal IN ('1000','4000') AND NOT (dt_consumo = date'2023-03-26' AND hr_consumo = '01:00')",
    select: "datahora,codigo_postal,consumo",
    orderBy: "datahora DESC,codigo_postal",
    dimensions: "codigo_postal",
    series: "consumo",
    units: "consumo=kWh",
  },
  policy: E_REDES_MONTHLY_PERIODS,
  staleAfterSeconds: 5_184_000,
  /** Once a month: the latest 168 hours of E-REDES's `consumos_horario_codigo_postal` dataset, by `datahora`, filtered at the source. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `consumos_horario_codigo_postal` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of `consumo`. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
