import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { ANEPC_DEPLOYMENT, ANEPC_MAX_BYTES, ANEPC_NORMALIZER, ANEPC_TRANSFORMER, collectAnepcFeed } from "#/publishers/anepc/anepc/index";

export const FEED = defineFeed(ANEPC_DEPLOYMENT, {
  slug: "anepc-active-occurrences-feed",
  config: { feed: "active-occurrences" },
  staleAfterSeconds: 900,
  policy: {
    name: "ANEPC active occurrences",
    version: 1,
    collection: {
      cadenceSeconds: 300,
      timeoutSeconds: 30,
      maxBytes: ANEPC_MAX_BYTES,
      maxOutputBytes: 12 * 1024 * 1024,
      maxRecordBytes: 64 * 1024,
      maxRecords: 2000,
      historyMode: "changes",
    },
  },
  /** Every five minutes: every protection-and-relief occurrence ANEPC lists as active right now. */
  fetch: ({ config, validator, library, fetch }) => collectAnepcFeed(config, validator, library.apiOrigin, fetch),
  /** ANEPC's occurrence list, into a table of active occurrences with their status, place and resources. */
  transform: { normalizer: ANEPC_NORMALIZER, buffered: (bytes, context) => runTransformer(ANEPC_TRANSFORMER, bytes, context) },
});
