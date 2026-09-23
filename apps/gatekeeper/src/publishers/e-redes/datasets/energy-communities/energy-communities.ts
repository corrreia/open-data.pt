import { defineFeed } from "#/catalog/define";
import { E_REDES_HOST, E_REDES_PERIODIC_SERIES } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-energy-communities-feed",
  config: { host: E_REDES_HOST, dataset: "comunidades-de-energia", orderBy: "data DESC,codigo_freguesia,tipo_acc_cer", limit: "5000" },
  policy: E_REDES_PERIODIC_SERIES,
  staleAfterSeconds: 1_209_600,
  /** Once a week: E-REDES's `comunidades-de-energia` dataset, up to 5000 records ordered by `data DESC,codigo_freguesia,tipo_acc_cer`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `comunidades-de-energia` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into a table. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
