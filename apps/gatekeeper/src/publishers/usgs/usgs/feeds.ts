import { USGS_MAX_BYTES } from "./usgs";

/** An hourly read of the 30-day catalog keeps every new event and every revision of an old one. */
export const USGS_POLICY = {
  name: "USGS rolling earthquake catalog",
  version: 1,
  collection: {
    cadenceSeconds: 3600,
    timeoutSeconds: 60,
    maxBytes: USGS_MAX_BYTES,
    maxOutputBytes: 12 * 1024 * 1024,
    maxRecordBytes: 32 * 1024,
    maxRecords: 20_000,
    historyMode: "changes",
  },
} as const;
