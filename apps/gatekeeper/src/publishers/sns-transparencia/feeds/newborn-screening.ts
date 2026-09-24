import { defineFeed } from "#/catalog/define";
import { SNS_HOST } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-newborn-screening-feed",
  title: "National newborn screening programme",
  description: "Annual newborn screening activity and detected cases published by INSA.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  config: { host: SNS_HOST, dataset: "programa-nacional-de-diagnostico-precoce", orderBy: "tempo", limit: "100" },
  policy: {
    name: "Opendatasoft slow series",
    version: 1,
    collection: {
      cadenceSeconds: 604_800,
      timeoutSeconds: 30,
      maxBytes: 2 * 1024 * 1024,
      historyMode: "changes",
    },
  },
  staleAfterSeconds: 1_209_600,
  /** Once a week: SNS Transparência's `programa-nacional-de-diagnostico-precoce` dataset, up to 100 records ordered by `tempo`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `programa-nacional-de-diagnostico-precoce` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into a table. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
