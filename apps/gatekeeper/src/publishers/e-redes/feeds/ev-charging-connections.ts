import { defineFeed } from "#/catalog/define";
import { E_REDES_HOST, E_REDES_PERIODIC_SERIES } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-ev-charging-connections-feed",
  title: "Electric-vehicle charging connection points",
  description: "The latest 1,000 quarterly charging connection aggregates by municipality and parish.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  config: {
    host: E_REDES_HOST,
    dataset: "postos_carregamento_ves",
    orderBy: "trimestre DESC,coddistrito,coddistritoconcelho,coddistritoconcelhofreguesia,potencia_maxima_admissivel",
    limit: "1000",
  },
  policy: E_REDES_PERIODIC_SERIES,
  staleAfterSeconds: 1_209_600,
  /** Once a week: E-REDES's `postos_carregamento_ves` dataset, up to 1000 records ordered by `trimestre DESC,coddistrito,coddistritoconcelho,coddistritoconcelhofreguesia,potencia_maxima_admissivel`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `postos_carregamento_ves` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into a table. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
