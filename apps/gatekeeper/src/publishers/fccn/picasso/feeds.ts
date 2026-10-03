import { PICASSO_MAX_BYTES } from "./picasso";

/** How much one collection of a GigaPIX chart may read; each feed sets how often. */
export const PICASSO_COLLECTION = {
  timeoutSeconds: 60,
  maxBytes: PICASSO_MAX_BYTES,
  maxRecords: 1000,
  maxRecordBytes: 4 * 1024,
  // Every point is a measurement worth keeping, and the served product is only the chart's window.
  historyMode: "changes",
} as const;
