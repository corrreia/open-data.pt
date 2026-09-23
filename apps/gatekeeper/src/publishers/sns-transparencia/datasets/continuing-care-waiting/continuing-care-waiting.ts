import { defineFeed } from "#/catalog/define";
import { SNS_DAILY_SERIES, SNS_HOST } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-continuing-care-waiting-feed",
  config: { host: SNS_HOST, dataset: "rncci-episodios", orderBy: "data DESC,regiao,tipologia", limit: "5000", series: "episodios" },
  policy: SNS_DAILY_SERIES,
  staleAfterSeconds: 172_800,
  /** Twice a day: SNS Transparência's `rncci-episodios` dataset, up to 5000 records ordered by `data DESC,regiao,tipologia`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `rncci-episodios` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of `episodios`. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
