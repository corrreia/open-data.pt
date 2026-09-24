import { defineFeed } from "#/catalog/define";
import { E_REDES_HOST, E_REDES_QUARTER_HOUR_SERIES } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-national-consumption-feed",
  title: "National electricity consumption",
  description: "The latest 15-minute national electricity consumption by voltage level, published by E-REDES.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  config: { host: E_REDES_HOST, dataset: "consumo-total-nacional", orderBy: "datahora DESC", limit: "1000", series: "total,bt,mt,at,mat" },
  policy: E_REDES_QUARTER_HOUR_SERIES,
  staleAfterSeconds: 172_800,
  /** Every six hours: E-REDES's `consumo-total-nacional` dataset, up to 1000 records ordered by `datahora DESC`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `consumo-total-nacional` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of its 5 measures. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
