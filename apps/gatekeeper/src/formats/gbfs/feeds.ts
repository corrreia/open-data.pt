export const DAY_SECONDS = 86_400;

export const REALTIME_POLICY = {
  name: "GBFS realtime snapshots",
  version: 4,
  collection: {
    cadenceSeconds: 180,
    timeoutSeconds: 30,
    maxBytes: 4 * 1024 * 1024,
    historyMode: "changes",
    // Vehicles move on every collection, and Bird's stations are virtual spots whose counts wobble with them:
    // their revisions are noise, over a million lake rows a day. The fleet series records the counts on every collection.
    withoutHistory: ["vehicles", "stations"],
  },
} as const;

// Docked systems have real stations, a few dozen each: how full a dock was is history worth keeping. Their vehicles are not.
export const DOCKED_POLICY = {
  ...REALTIME_POLICY,
  name: "GBFS docked system snapshots, ten minutes",
  collection: { ...REALTIME_POLICY.collection, cadenceSeconds: 600, withoutHistory: ["vehicles"] },
} as const;

// What a station and a system *are*: read once a day, because that is how often it changes.
export const REFERENCE_POLICY = {
  name: "GBFS system and station reference, daily",
  version: 1,
  collection: {
    cadenceSeconds: DAY_SECONDS,
    timeoutSeconds: 30,
    maxBytes: 4 * 1024 * 1024,
    historyMode: "changes",
  },
} as const;
