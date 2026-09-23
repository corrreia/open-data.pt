import { defineFeed } from "#/catalog/define";
import { SNS_DAILY_SERIES, SNS_HOST } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-inem-emergency-calls-feed",
  config: { host: SNS_HOST, dataset: "atividade-gripe-inem", orderBy: "periodo DESC", limit: "1000", series: "n_o_registos" },
  policy: SNS_DAILY_SERIES,
  staleAfterSeconds: 172_800,
  /** Twice a day: SNS Transparência's `atividade-gripe-inem` dataset, up to 1000 records ordered by `periodo DESC`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `atividade-gripe-inem` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of `n_o_registos`. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
