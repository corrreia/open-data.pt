import { defineFeed } from "#/catalog/define";
import { E_REDES_HOST, E_REDES_WEEKLY_PERIODS } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-municipal-contracted-capacity-feed",
  config: {
    host: E_REDES_HOST,
    limit: "10000",
    dataset: "potencia-contratada-contratos-ativos-municipio",
    timeField: "data",
    period: "month",
    windowPeriods: "12",
    select: "data,con_code,con_name,sum(potencia_contratada) as potencia_contratada",
    groupBy: "data,con_code,con_name",
    orderBy: "data DESC,con_code,con_name",
    dimensions: "con_code,con_name",
    series: "potencia_contratada",
    units: "potencia_contratada=kVA",
  },
  policy: E_REDES_WEEKLY_PERIODS,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 12 months of E-REDES's `potencia-contratada-contratos-ativos-municipio` dataset, by `data`, aggregated at the source. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `potencia-contratada-contratos-ativos-municipio` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of `potencia_contratada`. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
