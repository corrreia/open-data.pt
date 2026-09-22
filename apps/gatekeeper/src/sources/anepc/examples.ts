import type { ExampleFeed } from "../../index";
import { ANEPC_MAX_BYTES } from "./anepc";

export const ANEPC_EXAMPLES: ExampleFeed[] = [
  {
    slug: "anepc-active-occurrences-feed",
    dataset: "anepc-active-occurrences",
    config: { source: "anepc", feed: "active-occurrences" },
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
  },
];
