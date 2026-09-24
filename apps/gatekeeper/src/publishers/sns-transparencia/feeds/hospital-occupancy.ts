import { defineFeed } from "#/catalog/define";
import { SNS_HOST, SNS_MONTHLY_SERIES } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-hospital-occupancy-feed",
  title: "Hospital inpatient occupancy",
  description: "Monthly inpatient days, staffed beds, and occupancy rate by hospital.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  config: { host: SNS_HOST, dataset: "ocupacao-do-internamento", orderBy: "tempo DESC,instituicao", limit: "8000" },
  policy: SNS_MONTHLY_SERIES,
  staleAfterSeconds: 1_209_600,
  /** Once a week: SNS Transparência's `ocupacao-do-internamento` dataset, up to 8000 records ordered by `tempo DESC,instituicao`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `ocupacao-do-internamento` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into a table. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
