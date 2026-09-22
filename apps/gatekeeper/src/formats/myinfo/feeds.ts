/** A stop network changes when a stop moves or a line is redrawn: daily is often enough, and every change is worth keeping. */
export const MYINFO_NETWORK_POLICY = {
  name: "MYINFO network",
  version: 1,
  collection: {
    cadenceSeconds: 86_400,
    timeoutSeconds: 60,
    maxBytes: 4 * 1024 * 1024,
    historyMode: "changes",
  },
} as const;

/** A search answers for one day, so a daily collection sees every service pattern within a week. */
export const MYINFO_TIMETABLE_POLICY = {
  name: "MYINFO timetable",
  version: 1,
  collection: {
    cadenceSeconds: 86_400,
    timeoutSeconds: 60,
    maxBytes: 1024 * 1024,
    historyMode: "changes",
  },
} as const;
