import { IODA_MAX_BYTES, IODA_PAGE_LIMIT } from "./ioda";

const COLLECTION = {
  timeoutSeconds: 60,
  maxBytes: IODA_MAX_BYTES,
  maxOutputBytes: 4 * IODA_MAX_BYTES,
  maxRecordBytes: 16 * 1024,
  // One product per feed, and every change to an outage's duration or a
  // corrected signal point is worth keeping.
  historyMode: "changes",
} as const;

/**
 * IODA detects an outage in ten-minute bins, so a quarter of an hour keeps the
 * event log within about one bin of the source while asking for a two-kilobyte
 * answer ninety-six times a day.
 */
export const IODA_OUTAGE_POLICY = {
  name: "IODA measurement — republication permission required",
  version: 1,
  collection: { ...COLLECTION, cadenceSeconds: 900, maxRecords: IODA_PAGE_LIMIT },
} as const;

/**
 * Signals move in five- and ten-minute steps, but a connectivity series is
 * context rather than an alarm — the event log above is what answers "is
 * something wrong right now". One collection an hour over a three-hour window
 * republishes two hours already published, which is what picks up a bin IODA
 * filled in or corrected late; unchanged points cost the kernel no history.
 */
export const IODA_SIGNAL_POLICY = {
  name: "IODA measurement — republication permission required",
  version: 1,
  collection: { ...COLLECTION, cadenceSeconds: 3600, maxRecords: 5000 },
} as const;
