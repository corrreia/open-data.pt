import { defineFeed } from "#/catalog/define";
import { E_REDES_HOST, E_REDES_PERIODIC_SERIES } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-self-consumption-installations-feed",
  config: {
    host: E_REDES_HOST,
    dataset: "8-total-upac-mensal",
    orderBy: "data DESC,coddistrito,codconcelho,codfreguesia,tipo_de_tecnologia,nivel_de_tensao,escalao_de_potencia_instalada",
    limit: "1000",
  },
  policy: E_REDES_PERIODIC_SERIES,
  staleAfterSeconds: 1_209_600,
  /** Once a week: E-REDES's `8-total-upac-mensal` dataset, up to 1000 records ordered by `data DESC,coddistrito,codconcelho,codfreguesia,tipo_de_tecnologia,nivel_de_tensao,escalao_de_potencia_instalada`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `8-total-upac-mensal` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into a table. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
