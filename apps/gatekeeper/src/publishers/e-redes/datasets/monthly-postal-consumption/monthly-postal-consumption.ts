import { defineFeed } from "#/catalog/define";
import { E_REDES_HOST, E_REDES_WEEKLY_PERIODS } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-monthly-postal-consumption-feed",
  config: {
    host: E_REDES_HOST,
    limit: "10000",
    dataset: "02-consumos-faturados-por-codigo-postal-ultimos-5-anos",
    timeField: "date",
    period: "month",
    windowPeriods: "6",
    select: "date,codigopostal,energiaativa",
    orderBy: "date DESC,codigopostal",
    dimensions: "codigopostal",
    series: "energiaativa",
    units: "energiaativa=kWh",
  },
  policy: E_REDES_WEEKLY_PERIODS,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 6 months of E-REDES's `02-consumos-faturados-por-codigo-postal-ultimos-5-anos` dataset, by `date`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `02-consumos-faturados-por-codigo-postal-ultimos-5-anos` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of `energiaativa`. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
