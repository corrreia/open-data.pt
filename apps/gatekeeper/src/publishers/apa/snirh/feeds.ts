import type { FeedDefinition } from "../../../catalog/define";
import { SNIRH_MAX_BYTES } from "./snirh";

/**
 * A history slice of the busiest station network runs to about 60,000 points,
 * and every one of them is a revision the lake keeps. The server answers one
 * batch of 50 stations in 1 to 15 seconds depending on the hour, and the
 * weather network takes eleven batches plus the station list.
 */
const COLLECTION = {
  timeoutSeconds: 600,
  maxBytes: SNIRH_MAX_BYTES,
  maxOutputBytes: 16 * 1024 * 1024,
  maxRecordBytes: 4 * 1024,
  maxRecords: 150_000,
  historyMode: "changes",
} as const;

/**
 * The database takes in the telemetry of the day before in the small hours,
 * and a day's readings keep arriving after that; a few collections a day see
 * each of them within hours.
 */
export const SNIRH_HOURLY_POLICY: FeedDefinition["policy"] = {
  name: "SNIRH hourly station readings",
  version: 1,
  collection: { ...COLLECTION, cadenceSeconds: 10_800 },
};

export const SNIRH_DAILY_POLICY: FeedDefinition["policy"] = {
  name: "SNIRH daily station readings",
  version: 1,
  collection: { ...COLLECTION, cadenceSeconds: 21_600 },
};

/** Wells read by hand once a month, and bulletins published once a month: once a day is plenty. */
export const SNIRH_MONTHLY_POLICY: FeedDefinition["policy"] = {
  name: "SNIRH monthly readings and bulletins",
  version: 1,
  collection: { ...COLLECTION, cadenceSeconds: 86_400 },
};
