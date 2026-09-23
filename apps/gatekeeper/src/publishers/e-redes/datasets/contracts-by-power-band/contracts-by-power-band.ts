import { defineFeed } from "#/catalog/define";
import { E_REDES_HOST, E_REDES_WEEKLY_PERIODS } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-contracts-by-power-band-feed",
  config: {
    host: E_REDES_HOST,
    limit: "10000",
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
  },
  policy: E_REDES_WEEKLY_PERIODS,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 12 months of E-REDES's `clientes-por-escalao-de-potencia` dataset, by `data`, aggregated at the source. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `clientes-por-escalao-de-potencia` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of `numero_de_contratos`. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
