/** REN completes an electricity quarter-hour only twice an hour, so a faster cadence can never see a new point. */
export const REN_ELECTRICITY_POLICY = {
  name: "REN intraday chart data",
  version: 3,
  collection: {
    cadenceSeconds: 1_800,
    timeoutSeconds: 30,
    maxBytes: 2 * 1024 * 1024,
    historyMode: "changes",
  },
} as const;

/** The gas charts gain one point an hour. */
export const REN_GAS_POLICY = {
  name: "REN gas hourly chart data",
  version: 1,
  collection: {
    cadenceSeconds: 3_600,
    timeoutSeconds: 30,
    maxBytes: 2 * 1024 * 1024,
    historyMode: "changes",
  },
} as const;
