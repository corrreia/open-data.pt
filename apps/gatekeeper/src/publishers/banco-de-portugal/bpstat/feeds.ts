import type { FeedPolicy } from "#/index";

const MEBIBYTE = 1024 * 1024;

/** A whole BPstat dataset, read once a day. */
export const DAILY_STATISTICS = {
  name: "BPstat daily dataset snapshot",
  version: 1,
  collection: {
    cadenceSeconds: 86_400,
    timeoutSeconds: 180,
    maxBytes: 2 * MEBIBYTE,
    maxOutputBytes: 32 * MEBIBYTE,
    maxRecordBytes: 512 * 1024,
    maxRecords: 100_000,
    historyMode: "changes",
  },
} as const;

/** Selected series of a BPstat dataset and their latest observations. The IDs, not domain titles, select the actual Portuguese observations. */
function selectedSeriesPolicy(cadenceSeconds: number): FeedPolicy {
  return {
    name: "BPstat selected series and latest observations",
    version: 1,
    collection: {
      cadenceSeconds,
      timeoutSeconds: 120,
      maxBytes: 2 * 1024 * 1024,
      maxOutputBytes: 8 * 1024 * 1024,
      maxRecordBytes: 64 * 1024,
      maxRecords: 10_000,
      historyMode: "changes",
    },
  };
}

/** Selected series read once a day. */
export const SELECTED_SERIES_DAILY = selectedSeriesPolicy(86_400);

/** Selected series read once a week. */
export const SELECTED_SERIES_WEEKLY = selectedSeriesPolicy(604_800);

/** Selected series read once a month. */
export const SELECTED_SERIES_MONTHLY = selectedSeriesPolicy(2_592_000);
