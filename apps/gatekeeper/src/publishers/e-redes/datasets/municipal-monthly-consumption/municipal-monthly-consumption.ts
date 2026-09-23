import { defineFeed } from "#/catalog/define";
import { E_REDES_HOST, E_REDES_WEEKLY_PERIODS } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-municipal-monthly-consumption-feed",
  config: {
    host: E_REDES_HOST,
    limit: "10000",
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
  },
  policy: E_REDES_WEEKLY_PERIODS,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 12 months of E-REDES's `3-consumos-faturados-por-municipio-ultimos-10-anos` dataset, by `data`, aggregated at the source. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `3-consumos-faturados-por-municipio-ultimos-10-anos` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of `energia_ativa_kwh`. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
