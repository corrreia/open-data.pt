import { defineFeed } from "#/catalog/define";
import { SNS_HOST, SNS_MONTHLY_SERIES } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-emergency-triage-feed",
  config: {
    host: SNS_HOST,
    dataset: "atendimentos-em-urgencia-triagem-manchester",
    orderBy: "tempo DESC,instituicao",
    // Seven counts per row; the full table normalizes to more than 16 MiB.
    limit: "3000",
  },
  policy: SNS_MONTHLY_SERIES,
  staleAfterSeconds: 1_209_600,
  /** Once a week: SNS Transparência's `atendimentos-em-urgencia-triagem-manchester` dataset, up to 3000 records ordered by `tempo DESC,instituicao`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `atendimentos-em-urgencia-triagem-manchester` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into a table. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
