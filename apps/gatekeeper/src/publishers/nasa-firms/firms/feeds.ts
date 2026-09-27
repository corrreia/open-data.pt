import { FIRMS_MAX_BYTES } from "./firms";

/** FIRMS refreshes its near-real-time VIIRS pixels within about three hours of an overpass. */
export const FIRMS_POLICY = {
  cadenceSeconds: 10_800,
  timeoutSeconds: 60,
  maxBytes: FIRMS_MAX_BYTES,
  maxOutputBytes: 12 * 1024 * 1024,
  maxRecordBytes: 16 * 1024,
  maxRecords: 20_000,
  historyMode: "changes",
} as const;
