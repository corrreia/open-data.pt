import { defineFeed } from "#/catalog/define";
import { SNS_HOST, SNS_MONTHLY_SERIES } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-seasonal-flu-vaccination-coverage-feed",
  config: { host: SNS_HOST, dataset: "taxa-de-cobertura-da-vacina-antigripal-sazonal-na-populacao-em-portugal-continen", orderBy: "epoca_sazonal DESC", limit: "100" },
  policy: {
    ...SNS_MONTHLY_SERIES,
    name: "SNS annual series snapshot",
    collection: {
      ...SNS_MONTHLY_SERIES.collection,
      cadenceSeconds: 2_592_000,
    },
  },
  staleAfterSeconds: 5_184_000,
  /** Once a month: SNS Transparência's `taxa-de-cobertura-da-vacina-antigripal-sazonal-na-populacao-em-portugal-continen` dataset, up to 100 records ordered by `epoca_sazonal DESC`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `taxa-de-cobertura-da-vacina-antigripal-sazonal-na-populacao-em-portugal-continen` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into a table. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
