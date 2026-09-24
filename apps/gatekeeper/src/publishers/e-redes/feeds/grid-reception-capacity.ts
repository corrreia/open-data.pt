import { defineFeed } from "#/catalog/define";
import { E_REDES_HOST, E_REDES_PERIODIC_SERIES } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-grid-reception-capacity-feed",
  title: "Grid capacity for new generation",
  description: "Connected, committed, and still available capacity for new generation at each E-REDES substation.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  config: { host: E_REDES_HOST, dataset: "capacidade-rececao-rnd", orderBy: "chave", limit: "1000" },
  policy: E_REDES_PERIODIC_SERIES,
  staleAfterSeconds: 1_209_600,
  /** Once a week: E-REDES's `capacidade-rececao-rnd` dataset, up to 1000 records ordered by `chave`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `capacidade-rececao-rnd` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into a table. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
