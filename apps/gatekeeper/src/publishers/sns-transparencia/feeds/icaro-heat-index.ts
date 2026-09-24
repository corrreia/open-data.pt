import { defineFeed } from "#/catalog/define";
import { SNS_DAILY_SERIES, SNS_HOST } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-icaro-heat-index-feed",
  title: "ÍCARO heat and mortality index",
  description: "INSA's daily ÍCARO index of the expected effect of heat on mortality, including the forecast days ahead.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  config: { host: SNS_HOST, dataset: "evolucao-diaria-do-indice-icaro", orderBy: "periodo DESC", limit: "1000" },
  policy: SNS_DAILY_SERIES,
  staleAfterSeconds: 172_800,
  /** Twice a day: SNS Transparência's `evolucao-diaria-do-indice-icaro` dataset, up to 1000 records ordered by `periodo DESC`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `evolucao-diaria-do-indice-icaro` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into a table. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
