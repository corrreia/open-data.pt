import type { ExampleFeed } from "../../index";

/** PeeringDB requires prior permission for republication; do not auto-install before that approval. */
export const PEERINGDB_EXAMPLES: ExampleFeed[] = [
  {
    slug: "peeringdb-portugal-exchanges-feed",
    title: "Internet exchanges in Portugal",
    description:
      "Public non-contact PeeringDB directory metadata for Internet exchanges located in Portugal. Includes names, city, websites and protocol support; no contact emails, phone numbers, street addresses, traffic volumes, speed or outage claims. Record clocks are publisher updates, not API generation times.",
    config: { source: "peeringdb", feed: "exchanges", country: "PT" },
    publisher: "PeeringDB",
    topics: ["telecom"],
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
      serving: { licence: "PeeringDB Acceptable Use Policy; prior permission required for republication", attribution: "PeeringDB and its contributors" },
    },
  },
];
