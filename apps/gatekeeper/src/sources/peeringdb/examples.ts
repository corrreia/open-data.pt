import type { ExampleFeed } from "../../index";

/** PeeringDB requires prior permission for republication; do not auto-install before that approval. */
export const PEERINGDB_EXAMPLES: ExampleFeed[] = [
  {
    slug: "peeringdb-portugal-exchanges-feed",
    dataset: "peeringdb-portugal-exchanges",
    config: { source: "peeringdb", feed: "exchanges", country: "PT" },
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
  },
];
