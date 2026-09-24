import { defineFeed } from "#/catalog/define";
import { PEERINGDB_DEPLOYMENT, PEERINGDB_NORMALIZER, PEERINGDB_TRANSFORMER, collectPeeringdbFeed } from "#/publishers/peeringdb/peeringdb/index";

export const FEED = defineFeed(PEERINGDB_DEPLOYMENT, {
  slug: "peeringdb-portugal-exchanges-feed",
  title: "Internet exchanges in Portugal",
  description:
    "Public non-contact PeeringDB directory metadata for Internet exchanges located in Portugal. Includes names, city, websites and protocol support; no contact emails, phone numbers, street addresses, traffic volumes, speed or outage claims. Record clocks are publisher updates, not API generation times.",
  licence: "peeringdb-aup",
  attribution: "PeeringDB and its contributors",
  topics: ["telecom"],
  config: { feed: "exchanges", country: "PT" },
  staleAfterSeconds: 1_209_600,
  policy: {
    name: "PeeringDB directory — republication permission required",
    version: 1,
    collection: {
      cadenceSeconds: 604_800,
      timeoutSeconds: 60,
      maxBytes: 1024 * 1024,
      maxOutputBytes: 2 * 1024 * 1024,
      maxRecordBytes: 16 * 1024,
      maxRecords: 1000,
      historyMode: "changes",
    },
  },
  /** Once a week: every page of PeeringDB's active exchanges in Portugal, with their public non-contact fields only. */
  fetch: ({ config, library, fetch }) => collectPeeringdbFeed(config, library.apiOrigin, fetch),
  /** The pages, into one directory record per exchange. */
  transform: { normalizer: PEERINGDB_NORMALIZER, streaming: (body, context) => PEERINGDB_TRANSFORMER.transform(body, context) },
});
