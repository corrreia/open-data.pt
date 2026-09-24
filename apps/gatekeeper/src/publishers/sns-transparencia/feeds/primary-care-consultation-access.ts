import { defineFeed } from "#/catalog/define";
import { SNS_HOST, SNS_MONTHLY_SERIES } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-primary-care-consultation-access-feed",
  title: "Access to primary-care medical consultations",
  description: "Monthly consultation use among registered primary-care patients, by primary-care area.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  config: { host: SNS_HOST, dataset: "acesso-de-consultas-medicas-pela-populacao-inscrita", orderBy: "tempo DESC,entidade", limit: "7500" },
  policy: SNS_MONTHLY_SERIES,
  staleAfterSeconds: 1_209_600,
  /** Once a week: SNS Transparência's `acesso-de-consultas-medicas-pela-populacao-inscrita` dataset, up to 7500 records ordered by `tempo DESC,entidade`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `acesso-de-consultas-medicas-pela-populacao-inscrita` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into a table. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
