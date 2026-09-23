import { defineFeed } from "#/catalog/define";
import { E_REDES_HOST, E_REDES_MONTHLY_PERIODS } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-municipal-transformer-capacity-feed",
  config: {
    host: E_REDES_HOST,
    limit: "1000",
    dataset: "postos-transformacao-distribuicao",
    select: "coddistritoconcelho,con_name,count(cod_instalacao) as station_count,sum(potencia_transformacao_kva) as potencia_transformacao_kva",
    groupBy: "coddistritoconcelho,con_name",
    orderBy: "coddistritoconcelho,con_name",
    idFields: "coddistritoconcelho,con_name",
  },
  policy: E_REDES_MONTHLY_PERIODS,
  staleAfterSeconds: 5_184_000,
  /** Once a month: E-REDES's `postos-transformacao-distribuicao` dataset, up to 1000 records ordered by `coddistritoconcelho,con_name`, aggregated at the source. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `postos-transformacao-distribuicao` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into a table. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
