import type { ExampleFeed } from "../../index";
import { ANEPC_MAX_BYTES } from "./anepc";

export const ANEPC_EXAMPLES: ExampleFeed[] = [
  {
    slug: "anepc-active-occurrences-feed",
    title: "Active civil-protection occurrences in mainland Portugal",
    description:
      "Active ANEPC protection-and-relief operations, including accidents and fires, with source status, classification, location and responding resources. This is an operational snapshot, not an emergency alert service; call 112 in an emergency.",
    config: { source: "anepc", feed: "active-occurrences" },
    publisher: "anepc",
    topics: ["society", "health", "environment"],
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
      serving: {
        licence: "sgifr-terms",
        attribution: "ANEPC through ©SIFOR — Sistema de Informação de Fogos Rurais (https://www.sgifr.gov.pt)",
      },
    },
  },
];
