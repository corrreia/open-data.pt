import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { ANEPC_DEPLOYMENT, ANEPC_MAX_BYTES, ANEPC_NORMALIZER, ANEPC_TRANSFORMER, collectAnepcFeed } from "#/publishers/anepc/anepc/index";

export const FEED = defineFeed(ANEPC_DEPLOYMENT, {
  slug: "anepc-active-occurrences-feed",
  title: "Active civil-protection occurrences in mainland Portugal",
  description:
    "Active ANEPC protection-and-relief operations, including accidents and fires, with source status, classification, location and responding resources. This is an operational snapshot, not an emergency alert service; call 112 in an emergency.",
  licence: "sgifr-terms",
  attribution: "ANEPC through ©SIFOR — Sistema de Informação de Fogos Rurais (https://www.sgifr.gov.pt)",
  topics: ["environment", "health", "society"],
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
