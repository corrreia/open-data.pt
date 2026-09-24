import { defineFeed } from "#/catalog/define";
import { E_REDES_HOST, E_REDES_PERIODIC_SERIES } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-substation-load-feed",
  title: "Substation load",
  description: "Annual winter and summer load, installed power, and guaranteed power for each E-REDES substation.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  config: { host: E_REDES_HOST, dataset: "carga-na-subestacao", orderBy: "ano DESC,codigo_da_instalacao,inverno_verao", limit: "1000" },
  policy: E_REDES_PERIODIC_SERIES,
  staleAfterSeconds: 1_209_600,
  /** Once a week: E-REDES's `carga-na-subestacao` dataset, up to 1000 records ordered by `ano DESC,codigo_da_instalacao,inverno_verao`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `carga-na-subestacao` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into a table. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
