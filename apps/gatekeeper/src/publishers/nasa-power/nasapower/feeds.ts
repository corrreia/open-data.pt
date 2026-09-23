import { NASA_POWER_MAX_BYTES } from "./nasapower";

/** POWER settles its daily analysis over months, so a weekly read of a lagged 30-day window is enough. */
export const NASA_POWER_POLICY = {
  name: "NASA POWER daily regional analysis",
  version: 1,
  collection: {
    cadenceSeconds: 604_800,
    timeoutSeconds: 120,
    maxBytes: NASA_POWER_MAX_BYTES,
    maxOutputBytes: 12 * 1024 * 1024,
    maxRecordBytes: 16 * 1024,
    maxRecords: 20_000,
    historyMode: "changes",
  },
} as const;
