import type { FeedPolicy } from "#/catalog/define";
import { SNIRH_MAX_BYTES } from "./snirh";

/**
 * A history slice of the busiest station network runs to about 60,000 points,
 * and every one of them is a revision the lake keeps. The server answers one
 * batch of 50 stations in 1 to 15 seconds depending on the hour, and the
 * weather network takes eleven batches plus the station list.
 */
const COLLECTION = {
  timeoutSeconds: 900,
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
export const SNIRH_HOURLY_POLICY: FeedPolicy = { ...COLLECTION, cadenceSeconds: 10_800 };

export const SNIRH_DAILY_POLICY: FeedPolicy = { ...COLLECTION, cadenceSeconds: 21_600 };

/** Wells read by hand once a month, and bulletins published once a month: once a day is plenty. */
export const SNIRH_MONTHLY_POLICY: FeedPolicy = { ...COLLECTION, cadenceSeconds: 86_400 };

/**
 * The wells, daily like the other monthly readings but about a hundred requests at SNIRH's pace of one every five
 * seconds: 515 seconds on their own, and past fifteen minutes when they share that pace with the other SNIRH feeds.
 */
export const SNIRH_WELLS_POLICY: FeedPolicy = { ...COLLECTION, cadenceSeconds: 86_400, timeoutSeconds: 1800 };
