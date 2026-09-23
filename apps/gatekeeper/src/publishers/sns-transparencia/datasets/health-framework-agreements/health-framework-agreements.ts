import { defineFeed } from "#/catalog/define";
import { SNS_HOST } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-health-framework-agreements-feed",
  config: { host: SNS_HOST, dataset: "acordos-quadro-na-area-da-saude", orderBy: "referencia_do_acordo_quadro", limit: "500" },
  policy: {
    name: "Opendatasoft changing reference data",
    version: 1,
    collection: {
      cadenceSeconds: 86_400,
      timeoutSeconds: 30,
      maxBytes: 2 * 1024 * 1024,
      historyMode: "changes",
    },
  },
  staleAfterSeconds: 2_592_000,
  /** Once a day: SNS Transparência's `acordos-quadro-na-area-da-saude` dataset, up to 500 records ordered by `referencia_do_acordo_quadro`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `acordos-quadro-na-area-da-saude` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into a table. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
