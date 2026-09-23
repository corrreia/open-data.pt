const COLLECTION = {
  timeoutSeconds: 60,
  maxBytes: 1024 * 1024,
  maxOutputBytes: 2 * 1024 * 1024,
  maxRecordBytes: 16 * 1024,
  maxRecords: 5000,
  historyMode: "changes",
} as const;

/** Registrations and daily routing counts change by the day. */
export const RIPESTAT_DAILY_POLICY = {
  name: "RIPEstat research — republication permission required",
  version: 1,
  collection: { ...COLLECTION, cadenceSeconds: 86_400 },
} as const;

/** RIPE takes a routing snapshot at 00:00, 08:00 and 16:00 UTC, so a read every eight hours sees each one. */
export const RIPESTAT_ROUTING_STATUS_POLICY = {
  name: "RIPEstat research — republication permission required",
  version: 1,
  collection: { ...COLLECTION, cadenceSeconds: 28_800 },
} as const;
