import { defineFeed } from "#/catalog/define";
import { MEBIBYTE } from "#/formats/opendatasoft/feeds";
import { E_REDES_HOST } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-scheduled-interruptions-feed",
  config: { host: E_REDES_HOST, dataset: "network-scheduling-work", orderBy: "updatedatetime DESC,startdatetime,zipcode", limit: "500" },
  policy: {
    name: "E-REDES scheduled interruption changes",
    version: 1,
    collection: {
      cadenceSeconds: 21_600,
      timeoutSeconds: 30,
      maxBytes: 2 * MEBIBYTE,
      historyMode: "changes",
    },
  },
  staleAfterSeconds: 43_200,
  /** Every six hours: E-REDES's `network-scheduling-work` dataset, up to 500 records ordered by `updatedatetime DESC,startdatetime,zipcode`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `network-scheduling-work` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into a table. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
