import { defineFeed } from "#/catalog/define";
import { E_REDES_HOST, E_REDES_WEEKLY_PERIODS } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-self-consumption-exported-energy-feed",
  title: "Energy exported by self-consumption installations",
  description:
    "Monthly energy injected by self-consumption installations, summed by E-REDES into municipality and voltage-level totals for the latest six reporting months. Does not repeat the existing installation-count products.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  config: {
    host: E_REDES_HOST,
    limit: "10000",
    dataset: "energia_injectada_upac",
    timeField: "data",
    period: "month",
    windowPeriods: "6",
    select: "data,codigo_concelho,con_name,nivel_tensao,sum(energia) as energia",
    groupBy: "data,codigo_concelho,con_name,nivel_tensao",
    orderBy: "data DESC,codigo_concelho,con_name,nivel_tensao",
    dimensions: "codigo_concelho,con_name,nivel_tensao",
    series: "energia",
    units: "energia=kWh",
  },
  policy: E_REDES_WEEKLY_PERIODS,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 6 months of E-REDES's `energia_injectada_upac` dataset, by `data`, aggregated at the source. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `energia_injectada_upac` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of `energia`. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
